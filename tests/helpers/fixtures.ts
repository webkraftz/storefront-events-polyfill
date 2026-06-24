/**
 * Test fixtures — mock implementations of Shopify's `standard-events.js`
 * module surface and helpers for asserting event dispatch.
 *
 * The real module is hosted on Shopify's CDN; we mock the constructors and
 * the static helpers (`createPromise`, `createCartFromAjaxResponse`,
 * `eventName`) with semantically faithful but lightweight implementations.
 */

import { vi } from "vitest";

import {
  type AjaxCart,
  type CartEventClass,
  type DeferredPromise,
  type StandardEventsModule,
  type StorefrontCart,
} from "../../src/types.js";

/** Build a Storefront-API-shaped cart from an AJAX cart in the same shape
 * Shopify's createCartFromAjaxResponse produces. */
export function mockCreateCartFromAjaxResponse(ajax: AjaxCart): StorefrontCart {
  return {
    id: `gid://shopify/Cart/${ajax.token}`,
    totalQuantity: ajax.item_count,
    cost: {
      totalAmount: {
        amount: (ajax.total_price / 100).toFixed(2),
        currencyCode: ajax.currency ?? "USD",
      },
    },
    lines: {
      nodes: ajax.items.map((i) => ({
        id: `gid://shopify/CartLine/${i.key ?? i.id}`,
        quantity: i.quantity,
        merchandise: { id: `gid://shopify/ProductVariant/${i.variant_id}` },
      })),
    },
    discountCodes: ajax.discount_codes ?? [],
    note: ajax.note ?? null,
    attributes: ajax.attributes
      ? Object.entries(ajax.attributes).map(([key, value]) => ({ key, value }))
      : [],
  };
}

/** Build a deferred promise. */
function createDeferred<T>(): DeferredPromise<T> {
  let resolve!: (value: T) => void;
  let reject!: (reason: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

/** Build a mocked CartEventClass with name, statics, and a real Event constructor. */
function buildEventClass<Detail extends object>(eventName: string): CartEventClass<Detail> {
  class MockedEvent extends Event {
    detail: Detail;
    promise?: Promise<{ cart: StorefrontCart }>;
    constructor(detail: Detail) {
      super(eventName, { bubbles: true });
      this.detail = detail;
      const maybePromise = (detail as unknown as { promise?: Promise<{ cart: StorefrontCart }> })
        .promise;
      if (maybePromise) this.promise = maybePromise;
    }
  }
  const ctor = MockedEvent as unknown as CartEventClass<Detail>;
  Object.defineProperty(ctor, "eventName", { value: eventName, writable: false });
  Object.defineProperty(ctor, "createPromise", { value: () => createDeferred(), writable: false });
  Object.defineProperty(ctor, "createCartFromAjaxResponse", {
    value: mockCreateCartFromAjaxResponse,
    writable: false,
  });
  return ctor;
}

/** Build a full mock StandardEventsModule. */
export function buildMockStandardEventsModule(): StandardEventsModule {
  return {
    CartLinesUpdateEvent: buildEventClass("shopify:cart:lines-update"),
    CartNoteUpdateEvent: buildEventClass("shopify:cart:note-update"),
    CartDiscountUpdateEvent: buildEventClass("shopify:cart:discount-update"),
    CartErrorEvent: buildEventClass("shopify:cart:error"),
  };
}

/** Build a stub fetch that resolves /cart.js with a canned AJAX cart. */
export function buildAjaxCartFetch(ajax: AjaxCart): typeof fetch {
  return vi.fn(async (input: RequestInfo | URL) => {
    const url = typeof input === "string" ? input : input.toString();
    if (url.endsWith("/cart.js")) {
      return new Response(JSON.stringify(ajax), {
        status: 200,
        headers: { "Content-Type": "application/json" },
      });
    }
    return new Response("not found", { status: 404 });
  }) as unknown as typeof fetch;
}

/** Default AJAX cart shape used across tests. */
export const DEFAULT_AJAX_CART: AjaxCart = {
  token: "abc123",
  total_price: 4999,
  item_count: 1,
  currency: "USD",
  items: [
    {
      key: "line-1",
      id: 1234567890,
      product_id: 100,
      variant_id: 200,
      quantity: 1,
      price: 4999,
    },
  ],
  attributes: {},
  note: null,
  discount_codes: [],
};

/**
 * Capture dispatched events on a target. Returns an array that fills with
 * every event matching the configured names, plus a teardown for clean-up.
 */
export function captureEvents(
  target: EventTarget,
  eventNames: string[],
): { events: Event[]; teardown: () => void } {
  const events: Event[] = [];
  const handlers = eventNames.map((name) => {
    const handler = (e: Event): void => {
      events.push(e);
    };
    target.addEventListener(name, handler);
    return { name, handler };
  });
  return {
    events,
    teardown: () => {
      for (const { name, handler } of handlers) {
        target.removeEventListener(name, handler);
      }
    },
  };
}
