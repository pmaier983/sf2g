/**
 * The /races page body rendered with the real static data file: every event
 * renders as a row, course maps and profiles appear where a GPS file exists,
 * sources open in a new tab, filters narrow the list.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/render";
import { RacesPageContent } from "../races/RacesPageContent";
import {
  RACES_SEARCH_DEFAULTS,
  type DistanceUnit,
  type RacesFile,
  type RacesSearch,
} from "../../lib/races";
import { DEFAULT_ORIGIN, findOrigin, type Origin } from "../../lib/race-travel";

const DATA = JSON.parse(
  readFileSync(path.join(process.cwd(), "public/data/races-2027.json"), "utf8"),
) as RacesFile;

async function setup(
  search: Partial<RacesSearch> = {},
  opts: { origin?: Origin; unit?: DistanceUnit } = {},
) {
  const onSearchChange = vi.fn();
  const onOriginChange = vi.fn();
  const result = renderWithProviders(
    <RacesPageContent
      data={DATA}
      search={{ ...RACES_SEARCH_DEFAULTS, ...search }}
      onSearchChange={onSearchChange}
      origin={opts.origin ?? DEFAULT_ORIGIN}
      onOriginChange={onOriginChange}
      unit={opts.unit ?? "mi"}
    />,
  );
  // The memory router mounts the route a tick after render.
  await screen.findByRole("toolbar", { name: "Filter events" });
  return { ...result, onSearchChange, onOriginChange };
}

const travelOf = (id: string) =>
  document.getElementById(id)!.querySelector(".race-row__drive")!;

describe("RacesPageContent", () => {
  it("renders all 65 events with the header counts", async () => {
    const { container } = await setup();
    expect(container.querySelectorAll("article.race-row")).toHaveLength(65);
    const keys = container.querySelector(".races-page__keys")!;
    expect(keys.textContent).toContain("41 California events");
    expect(keys.textContent).toContain("10 CA road races");
    expect(keys.textContent).toContain("13 stage races dated for 2027");
    expect(keys.textContent).toContain("36 courses mapped");
  });

  it("shows 36 course maps + profiles and 5 'no GPS file' notes", async () => {
    const { container } = await setup();
    expect(container.querySelectorAll(".race-viz__map")).toHaveLength(36);
    expect(container.querySelectorAll(".race-viz__profile")).toHaveLength(36);
    expect(
      screen.getAllByText("No public GPS file found for this course yet."),
    ).toHaveLength(5);
  });

  it("spot checks: Patterson Pass, Cat's Hill, Copperopolis captions", async () => {
    await setup();
    const caption = (id: string) =>
      within(document.getElementById(id)!).getByText(/^One lap/).textContent;
    expect(caption("patterson-pass-road-race-2027")).toBe(
      "One lap · 22.14 mi · +1,990 ft · 242–1,552 ft",
    );
    expect(caption("los-gatos-roofing-cat-s-hill-classic-2027")).toBe(
      "One lap · 0.9 mi · +80 ft · 402–464 ft",
    );
    expect(caption("copperopolis-road-race-2027")).toBe(
      "One lap · 21.83 mi · +1,370 ft · 267–1,325 ft",
    );
  });

  it("every row has a sources line whose links open in a new tab", async () => {
    const { container } = await setup();
    const rows = container.querySelectorAll("article.race-row");
    for (const row of rows) {
      const sources = row.querySelector(".race-row__sources");
      expect(sources, row.id).not.toBeNull();
      expect(
        sources!.querySelectorAll(".race-row__source").length,
      ).toBeGreaterThan(0);
      for (const a of sources!.querySelectorAll("a")) {
        expect(a.getAttribute("target")).toBe("_blank");
        expect(a.getAttribute("rel")).toContain("noopener");
      }
    }
  });

  it("stage races without a 2027 date sit in their own list with 2026 dates", async () => {
    const { container } = await setup();
    const tba = container.querySelector<HTMLElement>(".races-page__tba")!;
    expect(
      within(tba).getByRole("heading", {
        name: "Stage races without a 2027 date yet",
      }),
    ).toBeInTheDocument();
    const rows = tba.querySelectorAll("article.race-row");
    expect(rows).toHaveLength(11);
    for (const row of rows) {
      expect(row.textContent).toContain("TBA");
      expect(row.textContent).toMatch(/2026 edition ran/);
    }
  });

  it("shows a travel mode per race from SF: bike, drive, overnight, flight", async () => {
    await setup();
    expect(travelOf("il-giro-di-san-francisco-2027").textContent).toContain(
      "🚲 Bike",
    );
    const aggie = travelOf("cal-aggie-criterium-2027").textContent!;
    expect(aggie).toContain("🚗 Drive");
    expect(aggie).toContain("1 h 51");
    expect(aggie).toContain("89 mi");
    expect(travelOf("redlands-bicycle-classic-2027").textContent).toContain(
      "🌙 Overnight drive",
    );
    expect(travelOf("tucson-bicycle-classic-2027").textContent).toContain(
      "✈️ Flight",
    );
    expect(travelOf("go-fast-criterium-2027").textContent).toContain(
      "Venue TBA",
    );
    // Legend counts add up to every race with a venue.
    const legend = screen.getByRole("list", { name: "How to get there" });
    const total = [...legend.querySelectorAll("b")].reduce(
      (n, b) => n + Number(b.textContent),
      0,
    );
    expect(total).toBe(DATA.events.filter((e) => e.lat !== null).length);
  });

  it("follows the MI/KM switcher", async () => {
    await setup({}, { unit: "km" });
    expect(travelOf("cal-aggie-criterium-2027").textContent).toContain(
      "143 km",
    );
    const pp = document.getElementById("patterson-pass-road-race-2027")!;
    expect(within(pp).getByText(/^One lap/).textContent).toBe(
      "One lap · 35.6 km · +607 m · 74–473 m",
    );
    // Every number the page computes follows the switcher (free-text race
    // notes from the data file stay as written).
    const computed = [
      ...document.querySelectorAll(
        ".race-row__drive, .race-viz__caption, .race-origin__note",
      ),
    ].map((el) => el.textContent);
    expect(computed.length).toBeGreaterThan(100);
    for (const t of computed) expect(t).not.toMatch(/\b(mi|mph|ft)\b/);
  });

  it("re-estimates from another origin and says so in the sources", async () => {
    await setup({}, { origin: findOrigin("Los Angeles")! });
    const redlands = document.getElementById("redlands-bicycle-classic-2027")!;
    expect(travelOf("redlands-bicycle-classic-2027").textContent).toContain(
      "🚗 Drive",
    );
    expect(travelOf("redlands-bicycle-classic-2027").textContent).toMatch(/~/);
    expect(redlands.textContent).toContain("Estimated from Los Angeles");
    expect(redlands.textContent).not.toContain("OSRM from SF City Hall");
  });

  it("typing a known place in From changes the origin", async () => {
    const user = userEvent.setup();
    const { onOriginChange } = await setup();
    const input = screen.getByLabelText("From");
    expect(input).toHaveValue("San Francisco");
    await user.clear(input);
    await user.type(input, "Oakland");
    expect(onOriginChange).toHaveBeenCalledWith(
      expect.objectContaining({ label: "Oakland" }),
    );
    await user.clear(input);
    await user.type(input, "Atlantis{Enter}");
    expect(screen.getByRole("status").textContent).toMatch(/Pick a place/);
  });

  it("season grid: one square per race day; clicking scrolls to and highlights the row", async () => {
    const user = userEvent.setup();
    const scrolled: string[] = [];
    const spy = vi
      .spyOn(Element.prototype, "scrollIntoView")
      .mockImplementation(function (this: Element) {
        scrolled.push(this.id);
      });
    const { container } = await setup();
    const grid = screen.getByRole("group", { name: "2027 race calendar" });
    expect(
      grid.querySelectorAll("button.race-season__cell").length,
    ).toBeGreaterThan(50);

    const pp = DATA.events.find(
      (e) => e.id === "patterson-pass-road-race-2027",
    )!;
    const square = grid.querySelector<HTMLButtonElement>(
      `button[data-day="${pp.start}"]`,
    )!;
    expect(square.getAttribute("aria-label")).toContain("Patterson Pass");
    await user.click(square);
    expect(scrolled).toContain(pp.id);
    await waitFor(() =>
      expect(document.getElementById(pp.id)!.className).toContain(
        "race-row--flash",
      ),
    );
    expect(container.querySelectorAll(".race-row--flash")).toHaveLength(1);
    spy.mockRestore();
  });

  it("season grid follows the filters", async () => {
    await setup({ section: "norcal" });
    const grid = screen.getByRole("group", { name: "2027 race calendar" });
    for (const b of grid.querySelectorAll("button.race-season__cell")) {
      expect(b.getAttribute("aria-label")).not.toMatch(
        /Redlands Bicycle Classic/,
      );
    }
  });

  it("filters narrow the list and chips report the change", async () => {
    const user = userEvent.setup();
    const { container, onSearchChange } = await setup({
      section: "norcal",
      type: "Road race",
    });
    const rows = container.querySelectorAll("article.race-row");
    expect(rows.length).toBeGreaterThan(0);
    expect(rows.length).toBeLessThan(27);
    for (const row of rows) {
      expect(row.querySelector(".race-tag")!.textContent).toBe("Road race");
    }
    expect(container.querySelector(".races-page__tba")).toBeNull();

    await user.click(screen.getByRole("radio", { name: /^SoCal 14$/ }));
    expect(onSearchChange).toHaveBeenCalledWith({ section: "socal" });
    const sortBy = screen.getByRole("radiogroup", { name: "Sort by" });
    await user.click(within(sortBy).getByRole("radio", { name: "Nearest" }));
    expect(onSearchChange).toHaveBeenCalledWith({ sort: "drive" });
    await user.click(within(sortBy).getByRole("radio", { name: "Hilliest" }));
    expect(onSearchChange).toHaveBeenCalledWith({ sort: "hilliest" });
  });

  it("sort options are visible chips, with the current one checked", async () => {
    await setup({ sort: "climb" });
    const sortBy = screen.getByRole("radiogroup", { name: "Sort by" });
    const names = within(sortBy)
      .getAllByRole("radio")
      .map((r) => r.textContent);
    expect(names).toEqual([
      "Date",
      "Nearest",
      "Quickest trip",
      "Hilliest",
      "Flattest",
      "Biggest climb",
      "A–Z",
    ]);
    expect(
      within(sortBy).getByRole("radio", { name: "Biggest climb" }),
    ).toHaveAttribute("aria-checked", "true");
    // Biggest climb puts Patterson Pass first in the list.
    expect(document.querySelector("article.race-row")!.id).toBe(
      "patterson-pass-road-race-2027",
    );
  });

  it("every mapped course gets a terrain badge and a climbing rate", async () => {
    const { container } = await setup();
    expect(container.querySelectorAll(".race-tag--terrain")).toHaveLength(36);
    const tag = (id: string) =>
      document.getElementById(id)!.querySelector(".race-tag--terrain")
        ?.textContent;
    expect(tag("patterson-pass-road-race-2027")).toBe("⛰️ Big climb");
    expect(tag("avrt-pescadero-road-race-2027")).toBe("〰️ Hilly");
    expect(tag("cal-aggie-criterium-2027")).toBe("➖ Flat");
    expect(tag("tucson-bicycle-classic-2027")).toBeUndefined();
    expect(
      document
        .getElementById("patterson-pass-road-race-2027")!
        .querySelector(".race-viz__rate")!.textContent,
    ).toBe("90 ft/mi of climbing");
  });

  it("terrain chips show counts and filter the list", async () => {
    const user = userEvent.setup();
    const { container, onSearchChange } = await setup({ terrain: "climb" });
    const group = screen.getByRole("radiogroup", { name: "Terrain" });
    expect(
      within(group)
        .getAllByRole("radio")
        .map((r) => r.textContent),
    ).toEqual(["All terrain", "➖ Flat 27", "〰️ Hilly 6", "⛰️ Big climb 3"]);
    const rows = container.querySelectorAll("article.race-row");
    expect([...rows].map((r) => r.id).sort()).toEqual([
      "copperopolis-road-race-2027",
      "patterson-pass-road-race-2027",
      "winters-road-race-2027",
    ]);
    await user.click(within(group).getByRole("radio", { name: /Hilly/ }));
    expect(onSearchChange).toHaveBeenCalledWith({ terrain: "hilly" });
  });

  it("renders the methodology section with a source link per topic", async () => {
    const { container } = await setup();
    const method = container.querySelector("#races-sources")!;
    // The data file's topics plus the page's own "Travel estimates".
    expect(method.querySelectorAll("dt")).toHaveLength(
      DATA.methodology.length + 1,
    );
    expect(method.textContent).toContain(`Compiled ${DATA.generatedOn}.`);
  });
});
