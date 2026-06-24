import { afterEach, describe, expect, it } from "vitest";

import { install } from "../src/index.js";

import { buildMockStandardEventsModule } from "./helpers/fixtures.js";

afterEach(() => {
  delete (window as { Shopify?: unknown }).Shopify;
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
