import { afterEach, describe, expect, it } from "vitest";

import {
  actionsRuntimeAvailable,
  hasNativeStandardEventsSupport,
  isOptedOut,
  libraryLoaded,
  readStandardEventsLibrary,
  updateCartConfigured,
} from "../src/capability.js";

import { buildMockStandardEventsModule } from "./helpers/fixtures.js";

afterEach(() => {
  delete (window as { Shopify?: unknown }).Shopify;
});

describe("hasNativeStandardEventsSupport", () => {
  it("returns false when window.Shopify is absent entirely", () => {
    expect(hasNativeStandardEventsSupport()).toBe(false);
  });

  it("returns false when Shopify.actions is present but no library / configured action", () => {
    window.Shopify = {
      actions: {
        updateCart: Object.assign(() => Promise.resolve({}), { isDefault: () => true }),
      },
    };
    expect(hasNativeStandardEventsSupport()).toBe(false);
  });

  it("returns true when StandardEvents library is loaded", () => {
    window.Shopify = { StandardEvents: buildMockStandardEventsModule() };
    expect(hasNativeStandardEventsSupport()).toBe(true);
  });

  it("returns true when updateCart action has been configured", () => {
    window.Shopify = {
      actions: {
        updateCart: Object.assign(() => Promise.resolve({}), { isDefault: () => false }),
      },
    };
    expect(hasNativeStandardEventsSupport()).toBe(true);
  });
});

describe("libraryLoaded", () => {
  it("requires the createPromise + createCartFromAjaxResponse statics", () => {
    window.Shopify = { StandardEvents: buildMockStandardEventsModule() };
    expect(libraryLoaded()).toBe(true);
  });

  it("rejects a malformed library that lacks the required statics", () => {
    window.Shopify = {
      StandardEvents: {
        CartLinesUpdateEvent: function MockEvent() {
          /* nothing */
        } as unknown as ReturnType<typeof buildMockStandardEventsModule>["CartLinesUpdateEvent"],
      } as unknown as ReturnType<typeof buildMockStandardEventsModule>,
    };
    expect(libraryLoaded()).toBe(false);
  });
});

describe("updateCartConfigured", () => {
  it("returns false when actions runtime is absent", () => {
    expect(updateCartConfigured()).toBe(false);
  });

  it("returns false when isDefault is not a function", () => {
    window.Shopify = {
      actions: {
        updateCart: () => Promise.resolve({}),
      },
    };
    expect(updateCartConfigured()).toBe(false);
  });

  it("returns true only when isDefault() === false", () => {
    window.Shopify = {
      actions: {
        updateCart: Object.assign(() => Promise.resolve({}), { isDefault: () => false }),
      },
    };
    expect(updateCartConfigured()).toBe(true);
  });

  it("swallows isDefault throws and returns false", () => {
    window.Shopify = {
      actions: {
        updateCart: Object.assign(() => Promise.resolve({}), {
          isDefault: () => {
            throw new Error("boom");
          },
        }),
      },
    };
    expect(updateCartConfigured()).toBe(false);
  });
});

describe("actionsRuntimeAvailable", () => {
  it("returns true when Shopify.actions.updateCart is a function", () => {
    window.Shopify = {
      actions: { updateCart: () => Promise.resolve({}) },
    };
    expect(actionsRuntimeAvailable()).toBe(true);
  });

  it("returns false otherwise", () => {
    expect(actionsRuntimeAvailable()).toBe(false);
    window.Shopify = {};
    expect(actionsRuntimeAvailable()).toBe(false);
  });
});

describe("isOptedOut", () => {
  it("returns false by default", () => {
    expect(isOptedOut()).toBe(false);
  });

  it("returns true when the opt-out flag is set", () => {
    window.Shopify = { RetenkaStandardEventsPolyfillDisabled: true };
    expect(isOptedOut()).toBe(true);
  });
});

describe("readStandardEventsLibrary", () => {
  it("returns the library reference when present", () => {
    const mod = buildMockStandardEventsModule();
    window.Shopify = { StandardEvents: mod };
    expect(readStandardEventsLibrary()).toBe(mod);
  });

  it("returns undefined when absent", () => {
    expect(readStandardEventsLibrary()).toBeUndefined();
  });
});
