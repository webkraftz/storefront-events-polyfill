/**
 * Installs an XMLHttpRequest.prototype.open + send interceptor that mirrors
 * the fetch interceptor for themes that still use classic XHR for cart
 * mutations (Dawn-derived themes, jQuery-based themes, older Theme Store
 * themes). Same scope — only Shopify cart endpoints are inspected.
 *
 * Pattern: we wrap `open` to remember the URL+method on each XHR instance,
 * then wrap `send` to capture the body before delegating. We attach a
 * `load`/`error`/`abort` listener so we know whether the mutation succeeded
 * before resolving/rejecting the dispatched event promises.
 */

import { type DispatchContext, dispatchIntents } from "../dispatcher.js";
import { matchCartEndpoint, parseCartRequest } from "../parsers/cart-request.js";

export type XhrInterceptorHandle = () => void;

interface XhrContext {
  url: string;
  method: string;
}

const XHR_CONTEXT_KEY = "__retenkaStandardEventsContext";

interface ContextualXhr extends XMLHttpRequest {
  [XHR_CONTEXT_KEY]?: XhrContext;
}

/**
 * Installs the XHR interceptor on the given window. Returns the uninstall
 * function. Idempotent.
 */
export function installXhrInterceptor(win: Window, ctx: DispatchContext): XhrInterceptorHandle {
  const winWithXhr = win as Window & { XMLHttpRequest?: typeof XMLHttpRequest };
  const XhrProto = winWithXhr.XMLHttpRequest?.prototype;
  if (!XhrProto) return () => {};

  // reason: open/send rely on the XHR instance as `this`; we always invoke
  // them via `.apply(this, args)` from the patched wrappers, preserving the
  // correct receiver. The unbound references are safe.
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalOpen = XhrProto.open;
  // eslint-disable-next-line @typescript-eslint/unbound-method
  const originalSend = XhrProto.send;

  // Explicit signatures rather than `Parameters<typeof X>` — the latter only
  // resolves to the LAST overload of `XhrProto.open` (the 5-arg form), which
  // then fails to assign to the 2-arg overload. Explicit optional params
  // satisfy both overload arities.
  function patchedOpen(
    this: ContextualXhr,
    method: string,
    url: string | URL,
    async?: boolean,
    username?: string | null,
    password?: string | null,
  ): void {
    const urlString = typeof url === "string" ? url : url.toString();
    if (matchCartEndpoint(urlString)) {
      this[XHR_CONTEXT_KEY] = { method: method.toUpperCase(), url: urlString };
    } else if (this[XHR_CONTEXT_KEY]) {
      // Reused XHR object pointed at a non-cart URL — clear stale context.
      delete this[XHR_CONTEXT_KEY];
    }
    // Always invoke via the 5-arg overload (TypeScript's typing of
    // Function.prototype.call against an overloaded method picks the LAST
    // overload). Per the XHR spec, `async` defaults to true when omitted —
    // we mirror that here so wrapped behavior matches unwrapped.
    return originalOpen.call(this, method, url, async ?? true, username, password);
  }

  function patchedSend(this: ContextualXhr, body?: Document | XMLHttpRequestBodyInit | null): void {
    const xhrContext = this[XHR_CONTEXT_KEY];
    if (!xhrContext) {
      return originalSend.call(this, body);
    }
    const bodyString = stringifyXhrBody(body);
    const parsed = parseCartRequest(xhrContext.url, bodyString);
    if (!parsed || parsed.intents.length === 0) {
      return originalSend.call(this, body);
    }

    const tx = dispatchIntents(parsed, ctx);
    const onSuccess = (): void => {
      if (this.status >= 200 && this.status < 300) {
        void tx.resolveWith();
      } else {
        tx.rejectWith(new Error(`Cart endpoint returned HTTP ${String(this.status)}`));
      }
    };
    const onFailure = (eventLabel: string): (() => void) => {
      return () => tx.rejectWith(new Error(`XHR ${eventLabel}: ${xhrContext.url}`));
    };

    this.addEventListener("load", onSuccess);
    this.addEventListener("error", onFailure("error"));
    this.addEventListener("abort", onFailure("aborted"));
    this.addEventListener("timeout", onFailure("timeout"));

    return originalSend.call(this, body);
  }

  XhrProto.open = patchedOpen;
  XhrProto.send = patchedSend;

  return () => {
    if (XhrProto.open === patchedOpen) {
      XhrProto.open = originalOpen;
    }
    if (XhrProto.send === patchedSend) {
      XhrProto.send = originalSend;
    }
  };
}

function stringifyXhrBody(
  body: Document | XMLHttpRequestBodyInit | null | undefined,
): string | undefined {
  if (body === undefined || body === null) return undefined;
  if (typeof body === "string") return body;
  if (body instanceof URLSearchParams) return body.toString();
  if (typeof FormData !== "undefined" && body instanceof FormData) {
    // Shopify product forms ship FormData (every `<form action="/cart/add">`
    // block on every theme). XHR-based cart code paths exist too on older
    // themes that don't use fetch. Convert to URL-encoded so the parser can
    // extract id / quantity. Iteration is non-destructive — the underlying
    // FormData remains intact for the network call.
    const params = new URLSearchParams();
    body.forEach((value, key) => {
      // FormData values can be string | File. Files don't appear in Shopify
      // cart endpoints — skip defensively.
      if (typeof value === "string") {
        params.append(key, value);
      }
    });
    return params.toString();
  }
  // Blob / ArrayBuffer / ReadableStream / Document — don't appear on real
  // cart endpoints, and reading would risk consuming the body.
  return undefined;
}
