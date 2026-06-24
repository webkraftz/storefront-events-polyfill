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

  // open(method, url, [...rest])
  function patchedOpen(this: ContextualXhr, ...args: Parameters<typeof originalOpen>): void {
    const [methodArg, urlArg] = args;
    const url = typeof urlArg === "string" ? urlArg : urlArg.toString();
    if (matchCartEndpoint(url)) {
      this[XHR_CONTEXT_KEY] = { method: methodArg.toUpperCase(), url };
    } else if (this[XHR_CONTEXT_KEY]) {
      // Reused XHR object pointed at a non-cart URL — clear stale context.
      delete this[XHR_CONTEXT_KEY];
    }
    return originalOpen.apply(this, args);
  }

  function patchedSend(this: ContextualXhr, ...args: Parameters<typeof originalSend>): void {
    const xhrContext = this[XHR_CONTEXT_KEY];
    if (!xhrContext) {
      return originalSend.apply(this, args);
    }
    const [body] = args;
    const bodyString = stringifyXhrBody(body);
    const parsed = parseCartRequest(xhrContext.url, bodyString);
    if (!parsed || parsed.intents.length === 0) {
      return originalSend.apply(this, args);
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

    return originalSend.apply(this, args);
  }

  // reason: XhrProto.open is an overload union (2-arg and 5-arg variants); our
  // rest-param patched form doesn't match either single overload structurally,
  // even though it's runtime-compatible with both. The cast resolves the tsc
  // mismatch; ESLint's no-unnecessary-type-assertion is a false positive here.
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  XhrProto.open = patchedOpen as typeof XhrProto.open;
  // eslint-disable-next-line @typescript-eslint/no-unnecessary-type-assertion
  XhrProto.send = patchedSend as typeof XhrProto.send;

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
  // FormData / Blob / ArrayBuffer / ReadableStream / Document — Shopify cart
  // endpoints don't use these, skip rather than misparse.
  return undefined;
}
