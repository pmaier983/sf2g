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
        p.getByRole("table", { name: "Cumulative leaderboard" }),
      ).toBeVisible();
      await expect(p.getByText("Ben Skyline").first()).toBeVisible();
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
    path: "/races",
    landmark: async (p) => {
      // Rendered client-side from the static JSON; wait for the rows.
      await expect(p.locator("article.race-row")).toHaveCount(65);
      await expect(p.locator(".race-viz__map")).toHaveCount(36);
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

test("segments: the Climbs preset changes the selection, the URL and the totals", async ({
  page,
}) => {
  const errors = watchConsole(page);
  await page.goto("/segments");
  const board = page.getByRole("table", { name: "Cumulative leaderboard" });
  await expect(board.locator("tbody tr").first()).toBeVisible();
  const summary = page.locator(".segment-picker__summary");
  await expect(summary).toContainText("5 segments");
  const firstTotal = await board.locator("tbody tr").first().textContent();

  await page.getByRole("radio", { name: "Climbs" }).click();
  await expect
    .poll(() => new URL(page.url()).searchParams.get("set"))
    .toBe("climbs");
  await expect(summary).toContainText("3 segments");
  await expect
    .poll(() => board.locator("tbody tr").first().textContent())
    .not.toBe(firstTotal);
  expect(errors).toEqual([]);
});

test("segments: tapping a bar removes that segment and makes the pick custom", async ({
  page,
}) => {
  const errors = watchConsole(page);
  await page.goto("/segments");
  const bar = page.getByRole("button", { name: /^Skyline Climb B,/ });
  await expect(bar).toHaveAttribute("aria-pressed", "true");
  await bar.click();
  await expect(bar).toHaveAttribute("aria-pressed", "false");
  await expect
    .poll(() => new URL(page.url()).searchParams.get("set"))
    .toBe("custom");
  const seg = new URL(page.url()).searchParams.get("seg") ?? "";
  expect(seg).toContain("900001");
  expect(seg).not.toContain("900002");
  await expect(page.locator(".segment-picker__summary")).toContainText(
    "4 segments",
  );
  // The shared link reproduces the pick.
  await page.reload();
  await expect(
    page.getByRole("button", { name: /^Skyline Climb B,/ }),
  ).toHaveAttribute("aria-pressed", "false");
  expect(errors).toEqual([]);
});

test("segments: the Segments view expands a board with Strava links", async ({
  page,
}) => {
  const errors = watchConsole(page);
  await page.goto("/segments?view=segments");
  const table = page.getByRole("table", { name: "Segment boards" });
  await table.getByText("Skyline Climb A").click();
  await expect(
    table.getByRole("link", { name: "View on Strava" }).first(),
  ).toBeVisible();
  await page.getByRole("tab", { name: "Crown" }).click();
  await expect(
    page.getByRole("table", { name: "Segment crown" }),
  ).toBeVisible();
  expect(errors).toEqual([]);
});

test("segments on a phone: no sideways scroll", async ({ browser }) => {
  const context = await browser.newContext({
    viewport: { width: 375, height: 812 },
  });
  const page = await context.newPage();
  await page.goto("/segments");
  await expect(
    page.getByRole("table", { name: "Cumulative leaderboard" }),
  ).toBeVisible();
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);
  await context.close();
});

test("segments: the route view's map tiles load and every segment is drawn", async ({
  page,
}) => {
  const errors = watchConsole(page);
  const tiles: number[] = [];
  page.on("response", (res) => {
    if (/\/\d+\/\d+\/\d+(@2x)?\.png/.test(res.url())) tiles.push(res.status());
  });
  await page.goto("/segments");
  await expect
    .poll(() => page.locator(".route-map img.leaflet-tile-loaded").count(), {
      timeout: 15_000,
    })
    .toBeGreaterThan(0);
  expect(tiles.filter((s) => s >= 400)).toEqual([]);
  await expect(page.locator("path.route-map__segment")).toHaveCount(5);
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

test("/races does not ask a first-time visitor to connect Strava", async ({
  page,
}) => {
  // Undo the beforeEach "already dismissed" flag: a true first visit.
  await page.addInitScript(() => {
    try {
      localStorage.removeItem("sf2g-sync-prompt-dismissed");
    } catch {}
  });
  await page.goto("/races");
  await expect(page.locator("article.race-row")).toHaveCount(65);
  await page.waitForTimeout(500);
  await expect(page.locator("dialog[open]")).toHaveCount(0);

  // The leaderboard still asks.
  await page.goto("/leaderboard");
  await expect(page.locator("dialog[open]")).toHaveCount(1);
});

test("/races on a phone: no sideways scroll, filters behind a toggle", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await page.goto("/races");
  await expect(page.locator("article.race-row")).toHaveCount(65);
  const overflow = await page.evaluate(
    () => document.documentElement.scrollWidth - window.innerWidth,
  );
  expect(overflow).toBeLessThanOrEqual(0);

  const toggle = page.getByRole("button", { name: /Filters/ });
  await expect(toggle).toBeVisible();
  await expect(page.getByRole("radio", { name: "Road race" })).toBeHidden();
  await toggle.click();
  await page.getByRole("radio", { name: "Road race" }).click();
  await expect(page).toHaveURL(/type=Road\+race/);
  await expect(toggle).toContainText("1 filter");
});
