import { afterEach, describe, expect, it } from "vitest";

import { installXhrInterceptor } from "../../src/interceptors/xhr.js";

import {
  DEFAULT_AJAX_CART,
  buildAjaxCartFetch,
  buildMockStandardEventsModule,
  captureEvents,
} from "../helpers/fixtures.js";

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

let uninstall: (() => void) | undefined;
afterEach(() => {
  uninstall?.();
  uninstall = undefined;
});

/**
 * happy-dom ships an XMLHttpRequest that talks to the real network by default.
 * For deterministic tests we install a minimal stub on `window.XMLHttpRequest`
 * that exposes the prototype hooks the interceptor cares about. The stub mirrors
 * the parts of the XHR contract we need (open + send + addEventListener + status).
 */
class StubXhr {
  status = 200;
  readyState = 0;
  responseText = "";
  private listeners = new Map<string, Array<(event: Event) => void>>();
  open(_method: string, _url: string): void {
    /* intercepted */
  }
  send(_body?: unknown): void {
    /* intercepted */
  }
  addEventListener(type: string, listener: (event: Event) => void): void {
    const arr = this.listeners.get(type) ?? [];
    arr.push(listener);
    this.listeners.set(type, arr);
  }
  /** Test helper to fire a fake load event with a given status. */
  triggerLoad(status: number): void {
    this.status = status;
    const handlers = this.listeners.get("load") ?? [];
    const event = new Event("load");
    for (const h of handlers) h(event);
  }
}
describe("installXhrInterceptor", () => {
  it("dispatches CartLinesUpdateEvent on a successful /cart/add.js XHR", async () => {
    const ctx = buildCtx();
    Object.defineProperty(window, "XMLHttpRequest", { value: StubXhr, configurable: true });

    uninstall = installXhrInterceptor(window, ctx);
    const capture = captureEvents(document, ["shopify:cart:lines-update"]);
    const xhr = new StubXhr();
    xhr.open("POST", "/cart/add.js");
    xhr.send(JSON.stringify({ id: 99, quantity: 1 }));
    expect(capture.events).toHaveLength(1);

    xhr.triggerLoad(200);
    await new Promise((resolve) => setTimeout(resolve, 0));

    capture.teardown();
  });

  it("does not dispatch on non-cart XHRs", () => {
    const ctx = buildCtx();
    Object.defineProperty(window, "XMLHttpRequest", { value: StubXhr, configurable: true });
    uninstall = installXhrInterceptor(window, ctx);
    const capture = captureEvents(document, ["shopify:cart:lines-update"]);
    const xhr = new StubXhr();
    xhr.open("GET", "/products/foo.js");
    xhr.send();
    expect(capture.events).toHaveLength(0);
    capture.teardown();
  });

  it("clears stale context when the same XHR is reused for a non-cart URL", () => {
    const ctx = buildCtx();
    Object.defineProperty(window, "XMLHttpRequest", { value: StubXhr, configurable: true });
    uninstall = installXhrInterceptor(window, ctx);
    const capture = captureEvents(document, ["shopify:cart:lines-update"]);
    const xhr = new StubXhr();
    xhr.open("POST", "/cart/add.js");
    xhr.open("GET", "/products/foo.js"); // reuse for a non-cart URL
    xhr.send(JSON.stringify({ id: 99, quantity: 1 }));
    expect(capture.events).toHaveLength(0);
    capture.teardown();
  });

  it("parses FormData bodies sent via XHR (Shopify product-form shape)", () => {
    // Every theme's <form action="/cart/add"> ships FormData. Some older
    // themes use XHR rather than fetch — parity with the fetch interceptor.
    const ctx = buildCtx();
    Object.defineProperty(window, "XMLHttpRequest", { value: StubXhr, configurable: true });
    uninstall = installXhrInterceptor(window, ctx);
    const capture = captureEvents(document, ["shopify:cart:lines-update"]);

    const fd = new FormData();
    fd.append("form_type", "product");
    fd.append("id", "49905871061185");
    fd.append("quantity", "1");

    const xhr = new StubXhr();
    xhr.open("POST", "/cart/add.js");
    xhr.send(fd);

    expect(capture.events).toHaveLength(1);
    const detail = (
      capture.events[0] as unknown as {
        detail: { action: string; lines: Array<{ merchandiseId: string; quantity: number }> };
      }
    ).detail;
    expect(detail.action).toBe("add");
    expect(detail.lines).toEqual([
      { merchandiseId: "gid://shopify/ProductVariant/49905871061185", quantity: 1 },
    ]);
    capture.teardown();
  });

  it("dispatches CartErrorEvent on a non-2xx response", async () => {
    const ctx = buildCtx();
    Object.defineProperty(window, "XMLHttpRequest", { value: StubXhr, configurable: true });
    uninstall = installXhrInterceptor(window, ctx);
    // Suppress event.promise rejection surfacing as an unhandled rejection
    // — the dispatcher correctly fulfills the contract; the test simulates a
    // consumer that doesn't attach .catch.
    const consume = (e: Event): void => {
      (e as Event & { promise?: Promise<unknown> }).promise?.catch(() => undefined);
    };
    document.addEventListener("shopify:cart:lines-update", consume);
    const capture = captureEvents(document, ["shopify:cart:error"]);
    const xhr = new StubXhr();
    xhr.open("POST", "/cart/add.js");
    xhr.send(JSON.stringify({ id: 99, quantity: 1 }));
    xhr.triggerLoad(500);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(capture.events.length).toBeGreaterThan(0);
    document.removeEventListener("shopify:cart:lines-update", consume);
    capture.teardown();
  });
});
