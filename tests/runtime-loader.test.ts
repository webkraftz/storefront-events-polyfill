import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  SHOPIFY_STANDARD_EVENTS_URL,
  StandardEventsLoadError,
  loadStandardEventsModule,
  resetLoaderState,
} from "../src/runtime-loader.js";

import { buildMockStandardEventsModule } from "./helpers/fixtures.js";

beforeEach(() => {
  resetLoaderState();
});

afterEach(() => {
  resetLoaderState();
  delete (window as { Shopify?: unknown }).Shopify;
});

describe("loadStandardEventsModule — URL constant", () => {
  it("hardcodes the canonical Shopify CDN URL", () => {
    expect(SHOPIFY_STANDARD_EVENTS_URL).toBe(
      "https://cdn.shopify.com/storefront/standard-events.js",
    );
  });
});

describe("loadStandardEventsModule — cached path", () => {
  it("returns the library directly when already exposed on window", async () => {
    const cached = buildMockStandardEventsModule();
    window.Shopify = { StandardEvents: cached };
    const stubImporter = vi.fn();
    const loaded = await loadStandardEventsModule(SHOPIFY_STANDARD_EVENTS_URL, stubImporter);
    expect(loaded).toBe(cached);
    expect(stubImporter).not.toHaveBeenCalled();
  });
});

describe("loadStandardEventsModule — fresh import path", () => {
  it("calls the injected importer with the URL and exposes the result on window", async () => {
    const mockModule = buildMockStandardEventsModule();
    const stubImporter = vi.fn(async () => mockModule);
    const loaded = await loadStandardEventsModule("https://example.test/se.js", stubImporter);

    expect(stubImporter).toHaveBeenCalledWith("https://example.test/se.js");
    expect(loaded).toBe(mockModule);
    expect(window.Shopify?.StandardEvents).toBe(mockModule);
  });

  it("deduplicates concurrent loads — second call returns the same promise as the first", async () => {
    const mockModule = buildMockStandardEventsModule();
    let resolveImport!: (mod: unknown) => void;
    const importPromise = new Promise<unknown>((res) => {
      resolveImport = res;
    });
    const stubImporter = vi.fn(() => importPromise);

    const first = loadStandardEventsModule(SHOPIFY_STANDARD_EVENTS_URL, stubImporter);
    const second = loadStandardEventsModule(SHOPIFY_STANDARD_EVENTS_URL, stubImporter);
    expect(stubImporter).toHaveBeenCalledTimes(1);

    resolveImport(mockModule);
    const [firstResult, secondResult] = await Promise.all([first, second]);
    expect(firstResult).toBe(mockModule);
    expect(secondResult).toBe(mockModule);
  });

  it("preserves an existing window.Shopify.StandardEvents and does not overwrite", async () => {
    const existing = buildMockStandardEventsModule();
    window.Shopify = { StandardEvents: existing };
    // Cached path returns existing — the loader doesn't even invoke the importer.
    const stubImporter = vi.fn();
    const loaded = await loadStandardEventsModule(SHOPIFY_STANDARD_EVENTS_URL, stubImporter);
    expect(loaded).toBe(existing);
    expect(window.Shopify?.StandardEvents).toBe(existing);
  });
});

describe("loadStandardEventsModule — failure paths", () => {
  it("wraps importer failures in StandardEventsLoadError", async () => {
    const cause = new Error("network error");
    const stubImporter = vi.fn(() => Promise.reject(cause));

    await expect(
      loadStandardEventsModule(SHOPIFY_STANDARD_EVENTS_URL, stubImporter),
    ).rejects.toBeInstanceOf(StandardEventsLoadError);
  });

  it("includes the URL in the wrapped error message", async () => {
    const stubImporter = vi.fn(() => Promise.reject(new Error("boom")));
    try {
      await loadStandardEventsModule("https://example.test/se.js", stubImporter);
      throw new Error("expected rejection");
    } catch (err) {
      expect((err as Error).message).toContain("https://example.test/se.js");
    }
  });

  it("rejects when the imported module is missing required event classes", async () => {
    const malformed = { CartLinesUpdateEvent: function () {} };
    const stubImporter = vi.fn(async () => malformed);

    await expect(
      loadStandardEventsModule(SHOPIFY_STANDARD_EVENTS_URL, stubImporter),
    ).rejects.toBeInstanceOf(StandardEventsLoadError);
  });

  it("rejects when CartLinesUpdateEvent lacks the required statics", async () => {
    const malformed = {
      CartLinesUpdateEvent: function () {},
      CartNoteUpdateEvent: function () {},
      CartDiscountUpdateEvent: function () {},
      CartErrorEvent: function () {},
    };
    const stubImporter = vi.fn(async () => malformed);

    await expect(
      loadStandardEventsModule(SHOPIFY_STANDARD_EVENTS_URL, stubImporter),
    ).rejects.toBeInstanceOf(StandardEventsLoadError);
  });

  it("clears inflight state on failure so a retry can run", async () => {
    const failingImporter = vi.fn(() => Promise.reject(new Error("first failure")));

    await expect(
      loadStandardEventsModule(SHOPIFY_STANDARD_EVENTS_URL, failingImporter),
    ).rejects.toBeInstanceOf(StandardEventsLoadError);

    // After failure, the next call should issue a fresh importer invocation.
    const mockModule = buildMockStandardEventsModule();
    const successImporter = vi.fn(async () => mockModule);
    const result = await loadStandardEventsModule(
      SHOPIFY_STANDARD_EVENTS_URL,
      successImporter,
    );
    expect(result).toBe(mockModule);
    expect(successImporter).toHaveBeenCalledTimes(1);
  });
});

describe("StandardEventsLoadError", () => {
  it("attaches the cause when provided", () => {
    const cause = new Error("inner");
    const err = new StandardEventsLoadError("outer", cause);
    expect(err.name).toBe("StandardEventsLoadError");
    expect(err.message).toBe("outer");
    expect(err.cause).toBe(cause);
  });

  it("works without a cause", () => {
    const err = new StandardEventsLoadError("outer");
    expect(err.name).toBe("StandardEventsLoadError");
    expect(err.cause).toBeUndefined();
  });
});
