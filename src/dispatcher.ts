/**
 * Translates parsed cart mutation intents into Shopify standard storefront
 * events, dispatches them, and resolves their `event.promise` deferreds with
 * a fresh cart payload converted from the AJAX `/cart.js` response via
 * `CartLinesUpdateEvent.createCartFromAjaxResponse`.
 *
 * Each call to `dispatchIntents` is a "transaction" — events are dispatched
 * eagerly with pending promises, the network operation runs, and on success
 * one shared cart fetch resolves every pending promise. Per Shopify's spec
 * (https://shopify.dev/docs/storefronts/themes/best-practices/standard-events
 * "Deferred promises"), the event dispatch order is not contractual and each
 * promise is independent — we resolve them in a single batch.
 */

import { type ParsedCartRequest } from "./parsers/cart-request.js";
import {
  type AjaxCart,
  type DeferredPromise,
  type StandardEventsModule,
  type StorefrontCart,
} from "./types.js";

interface PendingEvent {
  deferred: DeferredPromise<{ cart: StorefrontCart }>;
}

export interface DispatchContext {
  module: StandardEventsModule;
  target: EventTarget;
  fetch: typeof fetch;
}

export interface DispatchResult {
  /** Number of standard storefront events dispatched. */
  dispatchedCount: number;
  /** Resolved cart after the operation, or null if cart fetch failed. */
  resolvedCart: StorefrontCart | null;
}

/**
 * Synchronously dispatches all standard events implied by `parsed`. Returns a
 * deferred completion handle the caller invokes after the underlying network
 * mutation succeeds or fails:
 *
 *  - on success: pass the original response; we re-fetch `/cart.js` and
 *    resolve every pending event.promise.
 *  - on failure: pass the error; we reject every promise and dispatch a
 *    CartErrorEvent.
 */
export function dispatchIntents(
  parsed: ParsedCartRequest,
  ctx: DispatchContext,
): DispatchTransaction {
  const pending: PendingEvent[] = [];

  for (const intent of parsed.intents) {
    if (intent.kind === "lines") {
      const deferred = ctx.module.CartLinesUpdateEvent.createPromise<{ cart: StorefrontCart }>();
      const event = new ctx.module.CartLinesUpdateEvent({
        action: intent.action,
        context: "external",
        lines: intent.lines,
        promise: deferred.promise,
      });
      ctx.target.dispatchEvent(event);
      pending.push({ deferred });
    } else if (intent.kind === "note") {
      const deferred = ctx.module.CartNoteUpdateEvent.createPromise<{ cart: StorefrontCart }>();
      const event = new ctx.module.CartNoteUpdateEvent({
        context: "external",
        note: intent.note,
        promise: deferred.promise,
      });
      ctx.target.dispatchEvent(event);
      pending.push({ deferred });
    } else {
      const deferred = ctx.module.CartDiscountUpdateEvent.createPromise<{
        cart: StorefrontCart;
      }>();
      const event = new ctx.module.CartDiscountUpdateEvent({
        discountCodes: intent.discountCodes,
        promise: deferred.promise,
      });
      ctx.target.dispatchEvent(event);
      pending.push({ deferred });
    }
  }

  return {
    async resolveWith(): Promise<DispatchResult> {
      if (pending.length === 0) {
        return { dispatchedCount: 0, resolvedCart: null };
      }
      try {
        const ajaxCart = await fetchCartJs(ctx.fetch);
        const storefrontCart = ctx.module.CartLinesUpdateEvent.createCartFromAjaxResponse(ajaxCart);
        for (const p of pending) {
          p.deferred.resolve({ cart: storefrontCart });
        }
        return { dispatchedCount: pending.length, resolvedCart: storefrontCart };
      } catch (err) {
        // Cart fetch failed but the original mutation succeeded — listeners
        // get a rejection rather than hang forever. We DON'T dispatch
        // CartErrorEvent here; the mutation itself was fine, the fallout is
        // just that listeners can't read the new cart state.
        for (const p of pending) {
          p.deferred.reject(err);
        }
        return { dispatchedCount: pending.length, resolvedCart: null };
      }
    },
    rejectWith(error: unknown): void {
      for (const p of pending) {
        p.deferred.reject(error);
      }
      // Dispatch CartErrorEvent for the failed mutation. Listeners that care
      // about explicit error signaling (e.g., showing a toast) subscribe to
      // this event class.
      const code = errorCode(error);
      const message = error instanceof Error ? error.message : String(error);
      const errorEvent = new ctx.module.CartErrorEvent({ error: message, code });
      ctx.target.dispatchEvent(errorEvent);
    },
  };
}

export interface DispatchTransaction {
  /** Call after the underlying mutation succeeds — fetches /cart.js and resolves promises. */
  resolveWith(): Promise<DispatchResult>;
  /** Call after the underlying mutation fails — rejects promises and dispatches CartErrorEvent. */
  rejectWith(error: unknown): void;
}

async function fetchCartJs(fetchImpl: typeof fetch): Promise<AjaxCart> {
  const response = await fetchImpl("/cart.js", {
    method: "GET",
    headers: { Accept: "application/json" },
    credentials: "same-origin",
  });
  if (!response.ok) {
    throw new Error(`/cart.js returned HTTP ${String(response.status)}`);
  }
  return (await response.json()) as AjaxCart;
}

function errorCode(error: unknown): string {
  if (error instanceof Error && error.name === "AbortError") return "ABORTED";
  return "SERVICE_UNAVAILABLE";
}
