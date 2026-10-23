import "@testing-library/jest-dom/vitest";
import { afterEach } from "vitest";
import { cleanup } from "@testing-library/react";

afterEach(() => {
  cleanup();
});

// happy-dom has no layout engine. Give every element a desktop-sized box so
// TanStack Virtual (which measures its scroll container) renders rows.
const VIEWPORT = { width: 1280, height: 900 };
const rect = () =>
  ({
    x: 0,
    y: 0,
    top: 0,
    left: 0,
    width: VIEWPORT.width,
    height: VIEWPORT.height,
    right: VIEWPORT.width,
    bottom: VIEWPORT.height,
    toJSON() {},
  }) as DOMRect;
Element.prototype.getBoundingClientRect = rect;
for (const [prop, value] of [
  ["offsetWidth", VIEWPORT.width],
  ["offsetHeight", VIEWPORT.height],
  ["clientWidth", VIEWPORT.width],
  ["clientHeight", VIEWPORT.height],
] as const) {
  Object.defineProperty(HTMLElement.prototype, prop, {
    configurable: true,
    get: () => value,
  });
}

class ResizeObserverStub {
  constructor(private cb: ResizeObserverCallback) {}
  observe(target: Element) {
    this.cb(
      [
        {
          target,
          contentRect: rect(),
          borderBoxSize: [],
          contentBoxSize: [],
          devicePixelContentBoxSize: [],
        } as unknown as ResizeObserverEntry,
      ],
      this as unknown as ResizeObserver,
    );
  }
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver =
  ResizeObserverStub as unknown as typeof ResizeObserver;

if (!window.matchMedia) {
  window.matchMedia = (query: string) =>
    ({
      matches: false,
      media: query,
      onchange: null,
      addListener() {},
      removeListener() {},
      addEventListener() {},
      removeEventListener() {},
      dispatchEvent: () => false,
    }) as MediaQueryList;
}
