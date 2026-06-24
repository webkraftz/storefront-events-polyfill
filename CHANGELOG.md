# @retenka/storefront-events-polyfill

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
