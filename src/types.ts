/**
 * Type definitions for the Shopify Standard Storefront Events library
 * loaded from https://cdn.shopify.com/storefront/standard-events.js.
 *
 * We mirror only the surface area this polyfill consumes — the event
 * classes' static constructors, their `eventName` static fields, and
 * the deferred-promise factory. The cart payload subset that comes back
 * from `createCartFromAjaxResponse` follows Shopify's documented shape
 * (a subset of the Storefront GraphQL `Cart` type):
 * @see https://shopify.dev/docs/storefronts/themes/best-practices/standard-events
 */

/** Action label dispatched alongside cart line updates. */
export type CartLineAction = "add" | "update" | "remove";

/**
 * Context tag describing where the cart change originated. Themes use
 * "cart" / "product" / "dialog"; we tag our intercepted requests with
 * "external" so consumers can distinguish polyfill-sourced events from
 * theme- or Shopify-action-sourced events when needed.
 */
export type CartChangeContext = "cart" | "product" | "dialog" | "standard-action" | "external";

/** Single line entry in a CartLinesUpdateEvent payload. */
export interface CartLineUpdate {
  /** Required for 'add' — Storefront API merchandise GID (variant). */
  merchandiseId?: string;
  /** Required for 'update' / 'remove' — Storefront API CartLine GID. */
  id?: string;
  /** Target line quantity (0 == remove). */
  quantity: number;
}

/** Storefront-API-shaped subset of the cart returned by event.promise resolution. */
export interface StorefrontCart {
  id: string;
  totalQuantity: number;
  cost: {
    totalAmount: {
      amount: string;
      currencyCode: string;
    };
    subtotalAmount?: {
      amount: string;
      currencyCode: string;
    };
  };
  lines: {
    nodes?: Array<unknown>;
  };
  discountCodes?: Array<{ applicable: boolean; code: string }>;
  note?: string | null;
  attributes?: Array<{ key: string; value: string }>;
}

/** Deferred-promise wrapper returned by `<EventClass>.createPromise()`. */
export interface DeferredPromise<T> {
  promise: Promise<T>;
  resolve: (value: T) => void;
  reject: (reason: unknown) => void;
}

/** The shape of the loaded standard-events.js module surface area we use. */
export interface StandardEventsModule {
  CartLinesUpdateEvent: CartEventClass<{
    action: CartLineAction;
    context: CartChangeContext;
    lines: CartLineUpdate[];
    promise: Promise<{ cart: StorefrontCart }>;
  }>;
  CartNoteUpdateEvent: CartEventClass<{
    context: CartChangeContext;
    note: string;
    promise: Promise<{ cart: StorefrontCart }>;
  }>;
  CartDiscountUpdateEvent: CartEventClass<{
    discountCodes: Array<{ code: string }>;
    promise: Promise<{ cart: StorefrontCart }>;
  }>;
  CartErrorEvent: CartEventClass<{
    error: string;
    code: string;
  }>;
}

export interface CartEventClass<Detail extends object> {
  new (detail: Detail): Event & { detail: Detail; promise?: Promise<{ cart: StorefrontCart }> };
  readonly eventName: string;
  createPromise<T = { cart: StorefrontCart }>(): DeferredPromise<T>;
  createCartFromAjaxResponse(ajaxCart: AjaxCart): StorefrontCart;
}

/**
 * Subset of the AJAX `/cart.js` response shape we read. The full response
 * is wider; we only narrow to fields needed for fallback conversion when
 * `createCartFromAjaxResponse` isn't available, plus for our own logging.
 *
 * @see https://shopify.dev/docs/api/ajax/reference/cart#get-locale-cart-js
 */
export interface AjaxCart {
  token: string;
  total_price: number;
  item_count: number;
  items: AjaxCartLineItem[];
  attributes?: Record<string, string>;
  note?: string | null;
  currency?: string;
  discount_codes?: Array<{ code: string; applicable: boolean }>;
}

export interface AjaxCartLineItem {
  key?: string;
  id: number;
  product_id: number;
  variant_id: number;
  quantity: number;
  price: number;
  properties?: Record<string, string> | null;
}

/** Polyfill runtime options. */
export interface PolyfillOptions {
  /**
   * Override the URL the polyfill loads `standard-events.js` from. Default:
   * `https://cdn.shopify.com/storefront/standard-events.js`. Override only for
   * testing or if Shopify changes the canonical URL.
   */
  standardEventsUrl?: string;
  /**
   * Skip the polyfill entirely. Useful when the host opts out by setting a
   * window flag before this module loads.
   */
  disabled?: boolean;
  /**
   * Override the event target the polyfill dispatches against. Defaults to
   * `document`. Themes that dispatch on a specific container should leave
   * this alone — we follow Shopify's documented pattern.
   */
  target?: EventTarget;
  /**
   * Override fetch used to read `/cart.js` after a mutation. Tests inject
   * a stub here.
   */
  fetch?: typeof fetch;
}

/**
 * Returned by `install()` so callers can tear the polyfill down — restores
 * `window.fetch` + `XMLHttpRequest.prototype.open` to their pre-install values,
 * removes event listeners.
 */
export interface PolyfillHandle {
  /** Tear down all interception and listeners. */
  uninstall(): void;
  /** True after capability appears mid-lifetime and the polyfill self-disables. */
  isDisabled(): boolean;
}

/** Global flag consumers can set BEFORE loading the polyfill to skip install. */
export interface PolyfillGlobalFlags {
  /**
   * When `true`, `install()` returns a no-op handle without intercepting
   * anything. Useful for debugging or for merchants who want to disable
   * the polyfill without removing the script tag.
   */
  RetenkaStandardEventsPolyfillDisabled?: boolean;
}

declare global {
  interface Window {
    Shopify?: {
      actions?: {
        updateCart?: {
          (input: unknown): Promise<unknown>;
          isDefault?: () => boolean;
          configure?: (config: unknown) => boolean;
        };
        getCart?: (input?: unknown) => Promise<unknown>;
        openCart?: () => Promise<void>;
      };
      StandardEvents?: StandardEventsModule;
      country?: string;
      locale?: string;
    } & PolyfillGlobalFlags;
  }
}
