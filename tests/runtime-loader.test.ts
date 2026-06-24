import { afterEach, describe, expect, it } from "vitest";

import {
  SHOPIFY_STANDARD_EVENTS_URL,
  StandardEventsLoadError,
  loadStandardEventsModule,
  resetLoaderState,
} from "../src/runtime-loader.js";

import { buildMockStandardEventsModule } from "./helpers/fixtures.js";

afterEach(() => {
  resetLoaderState();
  delete (window as { Shopify?: unknown }).Shopify;
});

describe("loadStandardEventsModule", () => {
  it("returns the library directly when already exposed on window", async () => {
    const cached = buildMockStandardEventsModule();
    window.Shopify = { StandardEvents: cached };
    const loaded = await loadStandardEventsModule();
    expect(loaded).toBe(cached);
  });

  it("exposes the library on window.Shopify.StandardEvents after load", async () => {
    // Verify the URL constant has the canonical Shopify CDN path.
    expect(SHOPIFY_STANDARD_EVENTS_URL).toBe(
      "https://cdn.shopify.com/storefront/standard-events.js",
    );
  });

  it("StandardEventsLoadError attaches a meaningful name", () => {
    const err = new StandardEventsLoadError("boom");
    expect(err.name).toBe("StandardEventsLoadError");
    expect(err.message).toBe("boom");
  });
});
