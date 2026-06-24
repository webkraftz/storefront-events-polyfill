# @retenka/storefront-events-polyfill

## 1.0.0

### Major Changes

- cd72ad8: Initial release. Polyfill for Shopify's Standard Storefront Events on themes that don't yet dispatch them natively. Intercepts `/cart/{add,change,update,clear}.js` and dispatches `shopify:cart:lines-update` / `shopify:cart:note-update` / `shopify:cart:discount-update` / `shopify:cart:error` via Shopify's platform-hosted event classes (loaded from `https://cdn.shopify.com/storefront/standard-events.js`). 2.6 KB brotlied, self-disables on capability appearance, full TypeScript types.

All notable changes to this package will be documented in this file.

This file is automatically maintained by [changesets](https://github.com/changesets/changesets). Do not edit manually.
