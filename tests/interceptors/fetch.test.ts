import { afterEach, describe, expect, it, vi } from "vitest";

import { installFetchInterceptor } from "../../src/interceptors/fetch.js";

import {
  DEFAULT_AJAX_CART,
  buildAjaxCartFetch,
  buildMockStandardEventsModule,
  captureEvents,
} from "../helpers/fixtures.js";

afterEach(() => {
  vi.restoreAllMocks();
});

function buildCtx(): ReturnType<typeof buildContextHelper> {
  return buildContextHelper();
}
function buildContextHelper() {
  return {
    module: buildMockStandardEventsModule(),
    target: document,
    fetch: buildAjaxCartFetch(DEFAULT_AJAX_CART),
  };
}

describe("installFetchInterceptor", () => {
  it("passes through non-cart fetches without dispatching events", async () => {
    const ctx = buildCtx();
    const originalFetch = vi.fn(async () => new Response("ok"));
    Object.defineProperty(window, "fetch", { value: originalFetch, configurable: true });
    const uninstall = installFetchInterceptor(window, ctx);
    const capture = captureEvents(document, ["shopify:cart:lines-update"]);

    await window.fetch("/products/foo.js");

    expect(originalFetch).toHaveBeenCalledTimes(1);
    expect(capture.events).toHaveLength(0);
    capture.teardown();
    uninstall();
  });

  it("dispatches CartLinesUpdateEvent for /cart/add.js", async () => {
    const ctx = buildCtx();
    const realResponse = new Response(JSON.stringify({ items: [], item_count: 1 }), {
      status: 200,
    });
    const originalFetch = vi.fn(async () => realResponse);
    Object.defineProperty(window, "fetch", { value: originalFetch, configurable: true });

    const uninstall = installFetchInterceptor(window, ctx);
    const capture = captureEvents(document, ["shopify:cart:lines-update"]);

    await window.fetch("/cart/add.js", {
      method: "POST",
      body: JSON.stringify({ id: 12345, quantity: 1 }),
    });

    expect(capture.events).toHaveLength(1);
    expect(capture.events[0]?.type).toBe("shopify:cart:lines-update");
    capture.teardown();
    uninstall();
  });

  it("dispatches CartErrorEvent when /cart/* returns non-2xx", async () => {
    const ctx = buildCtx();
    const originalFetch = vi.fn(async () => new Response("nope", { status: 422 }));
    Object.defineProperty(window, "fetch", { value: originalFetch, configurable: true });

    const uninstall = installFetchInterceptor(window, ctx);
    // Consume event.promise rejections so they don't surface as unhandled —
    // consumers in production must attach .catch themselves; the polyfill's
    // job is to fulfill the promise contract per the standard-events spec.
    const onLinesUpdate = (e: Event): void => {
      const eventWithPromise = e as Event & { promise?: Promise<unknown> };
      eventWithPromise.promise?.catch(() => undefined);
    };
    document.addEventListener("shopify:cart:lines-update", onLinesUpdate);
    const capture = captureEvents(document, ["shopify:cart:lines-update", "shopify:cart:error"]);

    await window.fetch("/cart/add.js", {
      method: "POST",
      body: JSON.stringify({ id: 1, quantity: 1 }),
    });

    expect(capture.events.some((e) => e.type === "shopify:cart:lines-update")).toBe(true);
    // Allow microtask to settle for error dispatch.
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(capture.events.some((e) => e.type === "shopify:cart:error")).toBe(true);
    document.removeEventListener("shopify:cart:lines-update", onLinesUpdate);
    capture.teardown();
    uninstall();
  });

  it("uninstall restores the original fetch", async () => {
    const ctx = buildCtx();
    const originalFetch = vi.fn(async () => new Response("ok"));
    Object.defineProperty(window, "fetch", { value: originalFetch, configurable: true });
    const uninstall = installFetchInterceptor(window, ctx);
    expect(window.fetch).not.toBe(originalFetch);
    uninstall();
    expect(window.fetch).toBe(originalFetch);
  });

  it("returns a no-op uninstall when window.fetch is missing", () => {
    const ctx = buildCtx();
    const winWithoutFetch = { document } as unknown as Window;
    const uninstall = installFetchInterceptor(winWithoutFetch, ctx);
    expect(typeof uninstall).toBe("function");
    expect(() => uninstall()).not.toThrow();
  });
});
