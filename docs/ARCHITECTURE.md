# Architecture

This document explains the design decisions behind `@retenka/storefront-events-polyfill` and the trade-offs we considered.

## Goal

Make Shopify's [Standard Storefront Events](https://shopify.dev/docs/storefronts/themes/best-practices/standard-events) fire on legacy themes that haven't yet migrated to dispatch them. Apps subscribing to `shopify:cart:lines-update` (and siblings) should see events on every cart mutation, regardless of which theme is installed.

## Why this exists

Per Shopify's [actions docs](https://shopify.dev/docs/storefronts/themes/best-practices/standard-actions): standard events fire automatically only when:

1. The theme has loaded the [`@theme/standard-events`](https://shopify.dev/docs/storefronts/themes/best-practices/standard-events#loading-the-library) library AND explicitly dispatches events from its own cart UI code, OR
2. The theme has configured the platform-injected `Shopify.actions.updateCart` action via `.configure(...)` — auto-emits events on success.

Field reality on 2026-06-24: we tested a Horizon-derived dev shop (`momin-store-8732.myshopify.com`) and an older theme dev shop. Both have:

- The actions runtime loaded (`window.Shopify.actions` present)
- The standard-events library NOT loaded (`window.Shopify.StandardEvents` undefined)
- The actions runtime NOT configured (`Shopify.actions.updateCart.isDefault() === true`)
- Cart UI code calls `/cart/add.js` directly — bypassing the actions runtime

Neither shop's "Add to Cart" button fires `shopify:cart:lines-update`. Apps subscribed to that event see nothing.

Adoption is in early days. Without a polyfill, every app that subscribes to standard events sees broken cart-change detection on the vast majority of themes for the foreseeable future.

## Approach

We **don't** reimplement Shopify's event classes. We load Shopify's own `standard-events.js` module from the platform CDN and use its real `CartLinesUpdateEvent` / `CartNoteUpdateEvent` / `CartDiscountUpdateEvent` / `CartErrorEvent` constructors. This means:

- Event payload shape is always canonical (no schema drift)
- `event.promise` resolves to the Storefront-API-shaped cart via the official `createCartFromAjaxResponse` static
- Browser caches the module — the same one Shopify's actions runtime lazy-imports

What we add: a small (~2.6 KB brotlied) layer that:

1. **Detects capability** before installing (`hasNativeStandardEventsSupport`)
2. **Loads** the standard-events module from CDN
3. **Intercepts** `window.fetch` + `XMLHttpRequest.prototype.open/send` for Shopify cart endpoints (and only those)
4. **Parses** each cart mutation request body to determine which events to dispatch
5. **Dispatches** the events synchronously, with a deferred `event.promise` per event
6. **Resolves** all deferreds with one shared `/cart.js` fetch + `createCartFromAjaxResponse` conversion
7. **Self-disables** if native support appears mid-lifetime

## File-by-file

```
src/
├── index.ts                     // Public install() entrypoint
├── auto.ts                      // Side-effect import (./auto)
├── capability.ts                // hasNativeStandardEventsSupport + helpers
├── runtime-loader.ts            // Dynamic import of standard-events.js from CDN
├── dispatcher.ts                // Event construction + dispatch + promise resolution
├── lifecycle.ts                 // Self-disable on capability appearance
├── types.ts                     // TypeScript types mirroring the standard-events surface
├── interceptors/
│   ├── fetch.ts                 // window.fetch wrapper
│   └── xhr.ts                   // XMLHttpRequest prototype patch
└── parsers/
    └── cart-request.ts          // Body parsing + intent extraction
```

### `parsers/cart-request.ts`

One source of truth for what each `/cart/*.js` endpoint accepts. Maps:

| Endpoint          | Body shapes accepted                                              | Events emitted                                |
| ----------------- | ----------------------------------------------------------------- | --------------------------------------------- |
| `/cart/add.js`    | `{ id, quantity }` or `{ items: [...] }`; JSON or form-urlencoded | `lines-update` action=add                     |
| `/cart/change.js` | `{ id \| line, quantity }`                                        | `lines-update` action=update / remove         |
| `/cart/update.js` | `{ updates, attributes?, note?, discount? }`                      | up to 3 events (lines + note + discount)      |
| `/cart/clear.js`  | (no body)                                                         | `lines-update` action=remove with empty lines |

Mapping derived from [Shopify's AJAX cart reference](https://shopify.dev/docs/api/ajax/reference/cart) + experimentation against real cart endpoints. The parser is the only place that knows about Shopify's AJAX API shape — every other module operates on the platform-canonical Standard Events payload.

### `dispatcher.ts`

Each parsed cart mutation becomes a _transaction_:

1. Eagerly dispatch events (so listeners can capture them ASAP)
2. Pass `event.promise` per event — pending until step 4
3. Caller awaits the underlying HTTP mutation
4. On success: one `/cart.js` fetch + `createCartFromAjaxResponse` → resolve all pending promises with the same `{ cart }` payload
5. On failure: reject all pending promises + dispatch a `shopify:cart:error` event

Per the [standard events spec](https://shopify.dev/docs/storefronts/themes/best-practices/standard-events#deferred-promises): each `event.promise` is independent (no shared instance), and the dispatch ORDER between events from the same mutation is NOT contractual. Consumers MUST handle each promise independently.

### `interceptors/fetch.ts`

Wraps `window.fetch` via `Object.defineProperty` (more robust than direct assignment — some environments define `fetch` as a non-writable accessor). Non-cart requests pass through with zero overhead. Cart requests:

1. Snapshot the request body (cloning a `Request` if needed)
2. Parse the body
3. Dispatch events with pending promises
4. Forward the request to the original `fetch`
5. On response: resolve or reject the pending promises

The original response is returned to the caller immediately — our `/cart.js` follow-up runs in parallel with whatever the theme's code does next, so the polyfill never blocks UI updates.

### `interceptors/xhr.ts`

Mirror of the fetch interceptor for themes that still use classic XHR (Dawn, some Theme Store themes). Patches `XMLHttpRequest.prototype.open` to remember URL+method, and `.send` to capture the body and attach load/error/abort listeners.

### `capability.ts`

The capability detection follows the heuristic Shopify-AI recommends:

```ts
hasNativeStandardEventsSupport() =
  libraryLoaded() || // window.Shopify.StandardEvents has valid statics
  updateCartConfigured(); // Shopify.actions.updateCart.isDefault() === false
```

Edge cases:

- `actions.updateCart.isDefault() === true` does NOT imply "no events" — it just means the theme didn't call `.configure()`. The library could still be loaded; we check that too.
- A theme could load the library but not dispatch events from its UI (extremely unlikely in practice). We accept this as a known false-positive of the capability check.
- The capability is re-checked on `visibilitychange` + `pageshow` so themes that load the library lazily eventually appear.

### `lifecycle.ts`

Two listeners on `document` / `window`:

- `visibilitychange` → re-check capability when the page becomes visible
- `pageshow` → re-check on back-forward cache restore

When capability flips from false to true mid-session, the polyfill tears itself down (calls all `uninstall` functions for fetch interceptor, XHR interceptor, and itself). Avoids double-firing if a theme update mid-session adds native support.

## Open design decisions

### Why dispatch events EAGERLY (before the mutation succeeds)?

Per the standard-events spec ([deferred promises](https://shopify.dev/docs/storefronts/themes/best-practices/standard-events#deferred-promises)):

> Dispatch the event before the async operation starts […] then resolve the promise when the operation completes.

This matches Shopify's own actions runtime behavior. Listeners that want optimistic UI updates can act on `event.lines` immediately; listeners that need the resolved cart `await event.promise`.

### Why fetch `/cart.js` after the mutation rather than parsing the mutation response?

The `/cart/add.js` / `/cart/change.js` / `/cart/update.js` responses are AJAX-cart shape, not standard-events shape. `createCartFromAjaxResponse` is the documented converter. We pay one extra round-trip per cart mutation — acceptable for the cleanliness of using the canonical converter.

In theory we could pass the response body directly to `createCartFromAjaxResponse` (since `/cart/add.js` returns the same shape as `/cart.js`). We chose the explicit `/cart.js` re-fetch for two reasons:

1. Some endpoints (`/cart/change.js` in older themes) return slightly different shapes
2. Theme code that calls `/cart/add.js?selections=...` may not return the full cart at all

A future optimization could attempt the optimistic path with fallback. Not worth the complexity until production telemetry says otherwise.

### Why don't we polyfill `shopify:product:view` / `shopify:search:update` / etc.?

Per Shopify-AI (conv `conv_1782304899091_9rrsw6s47`), those events fire from theme UI lifecycle (DOM/page navigation), not from network requests. A fetch/XHR interceptor cannot detect "the product page was viewed" or "the customer typed in the search box." Those events MUST be dispatched by theme code at the relevant lifecycle moment.

For apps that need product views or search events, the only path is to ship a theme app block that the merchant installs, where the block dispatches the events.

## Source documents

- [Standard storefront events (themes)](https://shopify.dev/docs/storefronts/themes/best-practices/standard-events)
- [Standard storefront actions (themes)](https://shopify.dev/docs/storefronts/themes/best-practices/standard-actions)
- [Standard storefront events and actions (apps)](https://shopify.dev/docs/apps/build/online-store/standard-events-and-actions)
- [AJAX cart reference](https://shopify.dev/docs/api/ajax/reference/cart)

## Confirmation of the CDN URL

The polyfill loads from `https://cdn.shopify.com/storefront/standard-events.js`. Verified 2026-06-24 against a live Shopify storefront:

- HTTP 200, `Content-Type: text/javascript`
- Body includes `CartLinesUpdateEvent`, `CartNoteUpdateEvent`, `CartDiscountUpdateEvent`, `CartErrorEvent`
- Same version hash as the sibling `https://cdn.shopify.com/storefront/standard-actions.js` — confirming Shopify versions them together

If Shopify changes the URL, override via:

```ts
install({ standardEventsUrl: "https://cdn.shopify.com/storefront/standard-events.js" });
```
