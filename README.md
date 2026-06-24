# @retenka/storefront-events-polyfill

> Drop-in polyfill that makes Shopify's official Standard Storefront Events fire on themes that don't yet emit them natively.

[![npm version](https://img.shields.io/npm/v/@retenka/storefront-events-polyfill.svg)](https://www.npmjs.com/package/@retenka/storefront-events-polyfill)
[![CI](https://github.com/webkraftz/storefront-events-polyfill/actions/workflows/ci.yml/badge.svg)](https://github.com/webkraftz/storefront-events-polyfill/actions/workflows/ci.yml)
[![License: MIT](https://img.shields.io/badge/License-MIT-yellow.svg)](LICENSE)

Shopify [released](https://shopify.dev/docs/storefronts/themes/best-practices/standard-events) a standard event interface that lets storefront apps subscribe to cart, product, and search events without intercepting `window.fetch` or parsing theme DOM. The runtime is injected on every Liquid storefront, but the events are only dispatched when a theme:

- Loads the [`@theme/standard-events`](https://shopify.dev/docs/storefronts/themes/best-practices/standard-events#loading-the-library) library and dispatches events itself, OR
- Configures `Shopify.actions.updateCart` via `.configure(...)` (auto-emits events on success)

In practice, **almost no production theme does either today** — including Horizon-derived themes, Dawn, and every Theme Store theme. Their cart UIs still use raw `/cart/add.js` / `/cart/change.js` / `/cart/update.js` AJAX calls, which bypass the standard events runtime entirely.

This polyfill closes that gap. It:

1. Loads the official `standard-events.js` module from `https://cdn.shopify.com/storefront/standard-events.js` (the same module Shopify's own actions runtime lazy-imports)
2. Intercepts AJAX cart mutations (`/cart/add.js`, `/cart/change.js`, `/cart/update.js`, `/cart/clear.js`)
3. Dispatches the appropriate `shopify:cart:lines-update`, `shopify:cart:note-update`, `shopify:cart:discount-update`, and `shopify:cart:error` events with the documented payload shape — including the `event.promise` that resolves with a Storefront-API-shaped cart converted via `CartLinesUpdateEvent.createCartFromAjaxResponse`
4. Self-disables if native standard-events support appears mid-page-lifetime (e.g., theme update mid-session)

**Bundle size:** ~2.6 KB brotlied for the polyfill core. The Shopify-hosted events module is loaded lazily and cached by the browser (the same cache the platform's own actions runtime uses).

## Compatibility

| Surface                          | Status                                                              |
| -------------------------------- | ------------------------------------------------------------------- |
| Shopify storefront (desktop web) | ✅ Supported                                                        |
| Shopify storefront (mobile web)  | ✅ Supported                                                        |
| Shopify mobile app webview       | ✅ Supported (uses same DOM + actions runtime)                      |
| Headless / Hydrogen              | ❌ Not applicable (Hydrogen apps already use the Cart API directly) |
| Checkout / Customer Account      | ❌ Not applicable (different surfaces with their own event systems) |

## Install

### Option 1: Side-effect import (recommended for app developers)

```js
import "@retenka/storefront-events-polyfill/auto";
```

That's it. The polyfill auto-installs on import, becomes a no-op on themes with native support, and exposes its handle on `window.__retenkaStandardEventsPolyfill` for runtime introspection.

### Option 2: Programmatic install

```js
import { install } from "@retenka/storefront-events-polyfill";

const handle = await install();

// Later, if you need to tear it down:
handle.uninstall();
```

### Option 3: Direct script tag (for theme developers without a build step)

```html
<script
  type="module"
  src="https://cdn.jsdelivr.net/npm/@retenka/storefront-events-polyfill@1/dist/auto.js"
></script>
```

Place this snippet in your theme's `<head>` (typically `layout/theme.liquid` or `snippets/scripts.liquid`). The browser fetches it from the jsdelivr CDN, which mirrors npm automatically.

See [docs/MERCHANT_INSTALL.md](docs/MERCHANT_INSTALL.md) for non-developer-friendly install instructions.

## Usage

Once installed, listen to the standard events anywhere in your code:

```js
document.addEventListener("shopify:cart:lines-update", (event) => {
  console.log("Cart action:", event.action); // "add" | "update" | "remove"
  console.log("Lines:", event.lines);
  event.promise?.then(({ cart }) => {
    console.log("Updated cart:", cart);
    // cart.id, cart.totalQuantity, cart.cost.totalAmount.amount,
    // cart.lines.nodes, cart.discountCodes, etc.
  });
});

document.addEventListener("shopify:cart:note-update", (event) => {
  console.log("New note:", event.note);
  event.promise?.then(({ cart }) => {
    /* ... */
  });
});

document.addEventListener("shopify:cart:discount-update", (event) => {
  console.log("Discount codes:", event.discountCodes);
  event.promise?.then(({ cart }) => {
    /* ... */
  });
});

document.addEventListener("shopify:cart:error", (event) => {
  console.error("Cart mutation failed:", event.error, "code:", event.code);
});
```

**Important:** Always handle `event.promise` rejections — the standard-events spec requires it. The polyfill correctly rejects the promise on cart mutation failure, but if no `.catch` is attached you'll see an unhandled promise rejection warning.

## Opt-out

If you need to disable the polyfill at runtime (debugging, A/B testing, or a theme update):

```js
// Set BEFORE the polyfill script loads:
window.Shopify = window.Shopify || {};
window.Shopify.RetenkaStandardEventsPolyfillDisabled = true;
```

Or, if the side-effect import has already run:

```js
window.__retenkaStandardEventsPolyfill?.uninstall();
```

## Architecture

See [docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) for the design rationale, capability detection logic, dispatch transaction model, double-firing prevention, and references to the Shopify documentation that informed each decision.

## Contributing

See [docs/CONTRIBUTING.md](docs/CONTRIBUTING.md). The short version:

```bash
git clone https://github.com/webkraftz/storefront-events-polyfill
cd storefront-events-polyfill
nvm use  # or use Node >=20
npm install
npm test
npm run build
```

PRs that change behavior require a [changeset](https://github.com/changesets/changesets):

```bash
npm run changeset
```

## License

[MIT](LICENSE) © Retenka

## Acknowledgements

Built by the [Retenka](https://retenka.com) team for use across the Retenka loyalty + membership + discount stack, and open-sourced because every Shopify app in the storefront-events ecosystem hits the same theme-adoption-lag problem we did.

The polyfill loads and uses Shopify's official `@theme/standard-events` module unmodified — no shape conversion, no event schema duplication. We only fill in the dispatcher for legacy themes that haven't migrated to `Shopify.actions.updateCart` yet.
