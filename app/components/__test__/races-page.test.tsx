/**
 * The /races page body rendered with the real static data file: every event
 * renders as a row, course maps and profiles appear where a GPS file exists,
 * sources open in a new tab, filters narrow the list.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { describe, expect, it, vi } from "vitest";
import { screen, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { renderWithProviders } from "../../test/render";
import { RacesPageContent } from "../races/RacesPageContent";
import {
  RACES_SEARCH_DEFAULTS,
  type RacesFile,
  type RacesSearch,
} from "../../lib/races";

const DATA = JSON.parse(
  readFileSync(path.join(process.cwd(), "public/data/races-2027.json"), "utf8"),
) as RacesFile;

async function setup(search: Partial<RacesSearch> = {}) {
  const onSearchChange = vi.fn();
  const result = renderWithProviders(
    <RacesPageContent
      data={DATA}
      search={{ ...RACES_SEARCH_DEFAULTS, ...search }}
      onSearchChange={onSearchChange}
    />,
  );
  // The memory router mounts the route a tick after render.
  await screen.findByRole("toolbar", { name: "Filter events" });
  return { ...result, onSearchChange };
}

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

  it("flags long drives as likely a flight", async () => {
    await setup();
    const tucson = document.getElementById("tucson-bicycle-classic-2027")!;
    expect(tucson.textContent).toContain("likely a flight");
    const aggie = document.getElementById("cal-aggie-criterium-2027")!;
    expect(aggie.textContent).not.toContain("likely a flight");
    expect(aggie.textContent).toContain("1 h 51");
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
    await user.selectOptions(screen.getByLabelText("Sort events"), "drive");
    expect(onSearchChange).toHaveBeenCalledWith({ sort: "drive" });
  });

  it("renders the methodology section with a source link per topic", async () => {
    const { container } = await setup();
    const method = container.querySelector("#races-sources")!;
    expect(method.querySelectorAll("dt")).toHaveLength(DATA.methodology.length);
    expect(method.textContent).toContain(`Compiled ${DATA.generatedOn}.`);
  });
});
