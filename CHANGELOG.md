# @retenka/storefront-events-polyfill

## 1.0.2

### Patch Changes

- 2f052e4: Fix silent passthrough on FormData cart bodies. Shopify themes ship FormData
  on every `<form action="/cart/add">` block (the canonical product-form
  shape), but the fetch + XHR body readers only handled `string` and
  `URLSearchParams`. FormData fell through the `if` chain → returned
  `undefined` → parser computed 0 intents → no event dispatched.

  Both `snapshotRequestBody` (`src/interceptors/fetch.ts`) and `stringifyXhrBody`
  (`src/interceptors/xhr.ts`) now iterate FormData entries non-destructively
  (via `.forEach()`) and serialize string values into a `URLSearchParams`
  string so the existing `parseCartRequest` URL-encoded fallback handles them.
  File values (which Shopify cart endpoints never use) are skipped defensively.

  Field evidence on `plus-webkraftz-com` 2026-06-25 — theme's product form
  shipped `FormData: form_type=product, id=49905871061185, quantity=1, ...`
  which the polyfill silently passed through. Two new integration tests
  (one per interceptor) lock the FormData parsing in; the prior
  "falls through cleanly on FormData" test in `fetch.test.ts` was inverted
  to assert the new behavior.

- aa271ca: Fix silent no-op on Shopify Plus tier stores. `hasNativeStandardEventsSupport()`
  previously returned `true` whenever `window.Shopify.StandardEvents` was loaded,
  causing the polyfill to skip installation. Shopify auto-injects that runtime
  on Plus tier stores even when the theme is still using legacy
  `fetch('/cart/add.js')` endpoints that don't dispatch any events — so the
  polyfill bailed and the cart-event chain never fired. The check now relies
  solely on `Shopify.actions.updateCart.isDefault() === false`, which is the
  authoritative signal that the theme has wired the new actions runtime
  (which auto-emits standard events). Library presence alone is no longer
  treated as proof of native dispatch.

  Field evidence + full diagnostic on the `plus-webkraftz-com` staging shop —
  see `src/capability.ts` docblock for the regression detail. `libraryLoaded()`
  remains exported because the runtime loader still uses it to decide whether
  to re-fetch the standard-events runtime when missing.

## 1.0.1

### Patch Changes

- 94d19d0: Fix TypeScript overload-typing mismatch in the XHR interceptor. The
  `patchedOpen` / `patchedSend` wrappers previously used
  `Parameters<typeof X>` which only resolves to the LAST overload of
  `XhrProto.open`, requiring a runtime-only cast that ESLint correctly
  flagged as suspicious. Rewrote both with explicit signatures matching
  the overload union directly. No behavioral change; runtime is identical.

## 1.0.0

### Major Changes

- cd72ad8: Initial release. Polyfill for Shopify's Standard Storefront Events on themes that don't yet dispatch them natively. Intercepts `/cart/{add,change,update,clear}.js` and dispatches `shopify:cart:lines-update` / `shopify:cart:note-update` / `shopify:cart:discount-update` / `shopify:cart:error` via Shopify's platform-hosted event classes (loaded from `https://cdn.shopify.com/storefront/standard-events.js`). 2.6 KB brotlied, self-disables on capability appearance, full TypeScript types.

All notable changes to this package will be documented in this file.

This file is automatically maintained by [changesets](https://github.com/changesets/changesets). Do not edit manually.
