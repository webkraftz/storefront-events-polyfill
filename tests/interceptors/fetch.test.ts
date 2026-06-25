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

  it("extracts a URL string from URL objects passed as input", async () => {
    const ctx = buildCtx();
    const originalFetch = vi.fn(async () => new Response("ok"));
    Object.defineProperty(window, "fetch", { value: originalFetch, configurable: true });
    const uninstall = installFetchInterceptor(window, ctx);
    const capture = captureEvents(document, ["shopify:cart:lines-update"]);

    const url = new URL("https://shop.myshopify.com/cart/add.js");
    await window.fetch(url, {
      method: "POST",
      body: JSON.stringify({ id: 7, quantity: 1 }),
    });

    expect(capture.events).toHaveLength(1);
    capture.teardown();
    uninstall();
  });

  it("snapshots the body of a Request object via clone", async () => {
    const ctx = buildCtx();
    const originalFetch = vi.fn(async () => new Response("ok"));
    Object.defineProperty(window, "fetch", { value: originalFetch, configurable: true });
    const uninstall = installFetchInterceptor(window, ctx);
    const capture = captureEvents(document, ["shopify:cart:lines-update"]);

    const request = new Request("/cart/add.js", {
      method: "POST",
      body: JSON.stringify({ id: 9, quantity: 1 }),
    });
    await window.fetch(request);

    expect(capture.events).toHaveLength(1);
    capture.teardown();
    uninstall();
  });

  it("accepts URLSearchParams as a request body", async () => {
    const ctx = buildCtx();
    const originalFetch = vi.fn(async () => new Response("ok"));
    Object.defineProperty(window, "fetch", { value: originalFetch, configurable: true });
    const uninstall = installFetchInterceptor(window, ctx);
    const capture = captureEvents(document, ["shopify:cart:lines-update"]);

    await window.fetch("/cart/add.js", {
      method: "POST",
      body: new URLSearchParams({ id: "10", quantity: "1" }),
    });

    expect(capture.events).toHaveLength(1);
    capture.teardown();
    uninstall();
  });

  it("parses FormData bodies (canonical Shopify product-form shape) and dispatches lines:add", async () => {
    // Every theme's <form action="/cart/add"> ships FormData with at least
    // `id` (variant ID) + `quantity`. The polyfill MUST parse this — field
    // evidence from plus-webkraftz-com 2026-06-25 showed silent passthrough
    // breaking cart-driven storefront widgets on every form-based theme.
    const ctx = buildCtx();
    const originalFetch = vi.fn(async () => new Response("ok"));
    Object.defineProperty(window, "fetch", { value: originalFetch, configurable: true });
    const uninstall = installFetchInterceptor(window, ctx);
    const capture = captureEvents(document, ["shopify:cart:lines-update"]);

    const fd = new FormData();
    fd.append("form_type", "product");
    fd.append("id", "49905871061185");
    fd.append("quantity", "1");
    await window.fetch("/cart/add.js", { method: "POST", body: fd });

    expect(capture.events).toHaveLength(1);
    const detail = (capture.events[0] as { detail: { action: string; lines: Array<{ merchandiseId: string; quantity: number }> } }).detail;
    expect(detail.action).toBe("add");
    expect(detail.lines).toEqual([
      { merchandiseId: "gid://shopify/ProductVariant/49905871061185", quantity: 1 },
    ]);
    expect(originalFetch).toHaveBeenCalled();
    capture.teardown();
    uninstall();
  });

  it("skips FormData entries with File values (defensive — Shopify carts don't use Files)", async () => {
    const ctx = buildCtx();
    const originalFetch = vi.fn(async () => new Response("ok"));
    Object.defineProperty(window, "fetch", { value: originalFetch, configurable: true });
    const uninstall = installFetchInterceptor(window, ctx);
    const capture = captureEvents(document, ["shopify:cart:lines-update"]);

    const fd = new FormData();
    fd.append("id", "11");
    fd.append("quantity", "1");
    fd.append("attachment", new File(["x"], "x.txt", { type: "text/plain" }));
    await window.fetch("/cart/add.js", { method: "POST", body: fd });

    // File entry skipped silently; string entries still parsed → 1 lines:add event.
    expect(capture.events).toHaveLength(1);
    capture.teardown();
    uninstall();
  });

  it("rejects pending promises and throws when the underlying fetch throws", async () => {
    const ctx = buildCtx();
    const networkError = new Error("network down");
    const originalFetch = vi.fn(async () => Promise.reject(networkError));
    Object.defineProperty(window, "fetch", { value: originalFetch, configurable: true });
    const uninstall = installFetchInterceptor(window, ctx);
    const capture = captureEvents(document, ["shopify:cart:lines-update", "shopify:cart:error"]);
    const consume = (e: Event): void => {
      (e as Event & { promise?: Promise<unknown> }).promise?.catch(() => undefined);
    };
    document.addEventListener("shopify:cart:lines-update", consume);

    await expect(
      window.fetch("/cart/add.js", {
        method: "POST",
        body: JSON.stringify({ id: 1, quantity: 1 }),
      }),
    ).rejects.toBe(networkError);

    expect(capture.events.some((e) => e.type === "shopify:cart:error")).toBe(true);
    document.removeEventListener("shopify:cart:lines-update", consume);
    capture.teardown();
    uninstall();
  });
});
