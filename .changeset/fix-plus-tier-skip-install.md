---
"@retenka/storefront-events-polyfill": patch
---

Fix silent no-op on Shopify Plus tier stores. `hasNativeStandardEventsSupport()`
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
