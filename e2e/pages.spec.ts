import { expect, test, type Page } from "@playwright/test";

// Pretend the first-visit "Welcome to SF2G" dialog was already dismissed;
// it covers the page and would swallow every click.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    try {
      localStorage.setItem("sf2g-sync-prompt-dismissed", "true");
    } catch {}
  });
});

const ADA = "00000000-0000-4000-8000-000000000001";

/** Console noise that is not an app error (external tiles/analytics in a sandbox). */
const IGNORED_CONSOLE = [
  /Failed to load resource/i,
  /tile/i,
  /posthog/i,
  /Download the React DevTools/i,
];

function watchConsole(page: Page): string[] {
  const errors: string[] = [];
  page.on("console", (msg) => {
    if (msg.type() !== "error") return;
    const text = msg.text();
    if (IGNORED_CONSOLE.some((re) => re.test(text))) return;
    errors.push(text);
  });
  page.on("pageerror", (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

interface PageCase {
  path: string;
  /** Something that proves the page rendered real content. */
  landmark: (page: Page) => Promise<void>;
}

const PAGES: PageCase[] = [
  {
    path: "/leaderboard",
    landmark: async (p) => {
      await expect(p.getByText("Ada Bayway").first()).toBeVisible();
    },
  },
  {
    path: "/leaderboard?view=rides",
    landmark: async (p) => {
      await expect(p.locator("table tbody tr").first()).toBeVisible();
    },
  },
  {
    path: "/leaderboard?view=alltime",
    landmark: async (p) => {
      await expect(p.locator("table").first()).toBeVisible();
    },
  },
  {
    path: "/leaderboard?view=groups",
    landmark: async (p) => {
      await expect(p.getByText(/skyline/i).first()).toBeVisible();
    },
  },
  {
    path: `/profile/${ADA}`,
    landmark: async (p) => {
      await expect(p.getByText("Ada Bayway").first()).toBeVisible();
    },
  },
  {
    path: "/network",
    landmark: async (p) => {
      await expect(p.getByText(/rider network/i).first()).toBeVisible();
    },
  },
  {
    path: "/routes",
    landmark: async (p) => {
      await expect(p.locator(".leaflet-container").first()).toBeVisible();
    },
  },
  {
    path: "/segments",
    landmark: async (p) => {
      await expect(
        p.getByRole("table", { name: "Skyline segment board" }),
      ).toBeVisible();
      await expect(p.getByText("Skyline Climb A").first()).toBeVisible();
    },
  },
  {
    path: "/should-i-sf2g",
    landmark: async (p) => {
      await expect(p.getByText(/should i sf2g/i).first()).toBeVisible();
    },
  },
  {
    path: "/2sf2g",
    landmark: async (p) => {
      await expect(p.getByText(/should i sf2g/i).first()).toBeVisible();
    },
  },
  {
    path: "/privacy",
    landmark: async (p) => {
      await expect(
        p.getByRole("heading", { name: "Privacy Policy", exact: true }),
      ).toBeVisible();
    },
  },
];

for (const c of PAGES) {
  test(`${c.path} renders without errors`, async ({ page }) => {
    const errors = watchConsole(page);
    const res = await page.goto(c.path);
    expect(res?.status(), "HTTP status").toBeLessThan(400);
    await c.landmark(page);
    await page
      .waitForLoadState("networkidle", { timeout: 10_000 })
      .catch(() => {});

    expect(
      errors.filter((e) => /hydrat/i.test(e)),
      "hydration errors",
    ).toEqual([]);
    expect(errors, "console errors").toEqual([]);
  });
}

test("group ride detail opens from the groups view", async ({ page }) => {
  const errors = watchConsole(page);
  await page.goto("/leaderboard?view=groups");
  // Click the date cell — rider avatar cells stop propagation.
  await page.getByText("Oct 13, 2026").first().click();
  await expect(page).toHaveURL(/\/group-rides\//);
  await expect(page.getByText(/group ride/i).first()).toBeVisible();
  expect(errors.filter((e) => !/stream/i.test(e))).toEqual([]);
});

test("route filter chip narrows the riders table and updates the URL", async ({
  page,
}) => {
  await page.goto("/leaderboard");
  await expect(page.getByText("Ada Bayway").first()).toBeVisible();
  await page.getByRole("checkbox", { name: "Skyline" }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("routes"))
    .toContain("skyline");
  // Dee only rides Royale/Bayway, so she disappears with a Skyline filter.
  await expect(page.getByText("Dee Reverse")).toHaveCount(0);
  await expect(page.getByText("Ben Skyline").first()).toBeVisible();

  // The URL is the state: reloading (or sharing the link) keeps the filter.
  await page.reload();
  await expect(page.getByText("Ben Skyline").first()).toBeVisible();
  await expect(page.getByText("Dee Reverse")).toHaveCount(0);
});

test("segments: the Climbs chip narrows the board and updates the URL", async ({
  page,
}) => {
  const errors = watchConsole(page);
  await page.goto("/segments");
  const rows = page
    .getByRole("table", { name: "Skyline segment board" })
    .locator("tbody tr");
  await expect(page.getByText("Skyline Flat E").first()).toBeVisible();
  const before = await rows.count();

  await page.getByRole("radio", { name: "Climbs" }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("terrain"))
    .toBe("climb");
  await expect(page.getByText("Skyline Flat E")).toHaveCount(0);
  expect(await rows.count()).toBeLessThan(before);
  expect(errors).toEqual([]);
});

test("/routes map tiles load (no 'API KEY REQUIRED' provider)", async ({
  page,
}) => {
  const tiles: { url: string; status: number }[] = [];
  page.on("response", (res) => {
    if (/\/\d+\/\d+\/\d+(@2x)?\.png/.test(res.url()))
      tiles.push({ url: res.url(), status: res.status() });
  });
  await page.goto("/routes");
  await page.locator(".leaflet-container").first().scrollIntoViewIfNeeded();
  await expect
    .poll(() => page.locator("img.leaflet-tile-loaded").count(), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  expect(tiles.length).toBeGreaterThan(0);
  expect(tiles.filter((t) => t.status >= 400)).toEqual([]);
  expect(tiles.some((t) => t.url.includes("cartocdn"))).toBe(false);
});
