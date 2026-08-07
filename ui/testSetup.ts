import "@testing-library/jest-dom/vitest";

// jsdom has no canvas implementation; terminal renderers only need a harmless null context in tests.
if (typeof HTMLCanvasElement !== "undefined") {
  Object.defineProperty(HTMLCanvasElement.prototype, "getContext", {
    configurable: true,
    value: () => null,
  });
}
