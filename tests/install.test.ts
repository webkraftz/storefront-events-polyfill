import { afterEach, describe, expect, it, vi } from "vitest";

import { buildMockStandardEventsModule } from "./helpers/fixtures.js";

// Mock the runtime-loader module so install() resolves without making real
// network requests to https://cdn.shopify.com/storefront/standard-events.js.
// The mocked loader returns a faithful StandardEventsModule that exposes the
// real-looking createPromise/createCartFromAjaxResponse statics.
vi.mock("../src/runtime-loader.js", async () => {
  return {
    SHOPIFY_STANDARD_EVENTS_URL: "https://cdn.shopify.com/storefront/standard-events.js",
    loadStandardEventsModule: vi.fn(async () => buildMockStandardEventsModule()),
    resetLoaderState: vi.fn(),
    StandardEventsLoadError: class extends Error {
      override readonly name = "StandardEventsLoadError";
    },
  };
});

import { install } from "../src/index.js";

afterEach(() => {
  delete (window as { Shopify?: unknown }).Shopify;
  vi.clearAllMocks();
});

describe("install — no-op paths", () => {
  it("returns a no-op handle when opted out via global flag", async () => {
    window.Shopify = { RetenkaStandardEventsPolyfillDisabled: true };
    const handle = await install();
    expect(handle.isDisabled()).toBe(true);
  });

  it("returns a no-op handle when StandardEvents library is already loaded", async () => {
    window.Shopify = { StandardEvents: buildMockStandardEventsModule() };
    const handle = await install();
    expect(handle.isDisabled()).toBe(true);
  });

  it("returns a no-op handle when updateCart action has been configured", async () => {
    window.Shopify = {
      actions: {
        updateCart: Object.assign(() => Promise.resolve({}), { isDefault: () => false }),
      },
    };
    const handle = await install();
    expect(handle.isDisabled()).toBe(true);
  });

  it("returns a no-op handle when explicitly disabled via options", async () => {
    const handle = await install({ disabled: true });
    expect(handle.isDisabled()).toBe(true);
  });
});

describe("install — happy path", () => {
  it("returns an active handle when no native support is detected", async () => {
    const handle = await install();
    expect(handle.isDisabled()).toBe(false);
    handle.uninstall();
  });

  it("uninstall flips isDisabled to true and removes interceptors", async () => {
    const handle = await install();
    expect(handle.isDisabled()).toBe(false);
    handle.uninstall();
    expect(handle.isDisabled()).toBe(true);
  });

  it("uninstall is idempotent — calling twice does not throw", async () => {
    const handle = await install();
    handle.uninstall();
    expect(() => handle.uninstall()).not.toThrow();
    expect(handle.isDisabled()).toBe(true);
  });

  it("accepts a custom target for event dispatch", async () => {
    const target = new EventTarget();
    const handle = await install({ target });
    expect(handle.isDisabled()).toBe(false);
    handle.uninstall();
  });

  it("self-disables when native support appears after install", async () => {
    const handle = await install();
    expect(handle.isDisabled()).toBe(false);
    window.Shopify = { StandardEvents: buildMockStandardEventsModule() };
    Object.defineProperty(document, "visibilityState", { value: "visible", configurable: true });
    document.dispatchEvent(new Event("visibilitychange"));
    expect(handle.isDisabled()).toBe(true);
  });
});
