# Merchant install guide

This guide is for **theme developers and merchants** who want to install the polyfill on their Shopify storefront so that apps (Retenka and others) can detect cart changes reliably.

If you're a Shopify app developer integrating the polyfill into your own app, see the [main README](../README.md) instead.

## When do I need this?

You need this if you're running an app that expects to detect cart changes on your storefront in real time (loyalty programs, points-redemption widgets, free-gift-with-purchase progress bars, etc.) and the app's widgets don't update when customers add or remove items.

You may NOT need this if:

- Your theme is Horizon (Shopify's flagship modern theme) AND has been updated to a version that natively dispatches standard events. Check by opening your storefront's browser console and running:

  ```js
  window.Shopify?.StandardEvents;
  ```

  If that returns an object (not `undefined`), your theme already supports standard events.

- Your storefront uses a headless framework (Hydrogen, Next.js Commerce, etc.). These bypass the AJAX cart entirely.

If unsure, install the polyfill — it auto-detects native support and becomes a no-op when not needed.

## Install (1 minute)

Add this `<script>` tag to your theme's `<head>` section:

```html
<script
  type="module"
  src="https://cdn.jsdelivr.net/npm/@retenka/storefront-events-polyfill@1/dist/auto.js"
></script>
```

### Where to put it

Open your theme's code editor (Online Store → Themes → "Edit code"). Find one of:

- `layout/theme.liquid` — look for the closing `</head>` tag, paste the snippet on the line ABOVE it
- `snippets/scripts.liquid` (if your theme uses one) — paste at the top

Save. Reload your storefront. The polyfill loads and starts dispatching standard events. No further configuration needed.

### Version pinning

The `@1` in the URL pins to the latest 1.x.x release. We follow [semantic versioning](https://semver.org):

- Patch releases (1.0.x): bug fixes only
- Minor releases (1.x.0): new features, no breaking changes
- Major releases (2.0.0, etc.): breaking changes

Pinning to `@1` rolls forward through 1.x patches and minors automatically. Pin to a specific version (`@1.2.3`) if you want absolute stability.

## Verification

Open your storefront in a browser, open DevTools Console (F12), and run:

```js
// 1. Confirm the polyfill is installed
window.__retenkaStandardEventsPolyfill?.isDisabled();
// false → active, true → no-op because theme has native support

// 2. Subscribe to a cart event
document.addEventListener("shopify:cart:lines-update", (e) => {
  console.log("Cart changed:", e.action, e.lines);
});

// 3. Click "Add to Cart" on any product
```

You should see `Cart changed: add [...]` log in the console.

## Uninstall

Three ways, depending on why:

### Temporarily disable for one page load

Append `?retenkaPolyfill=off` to your storefront URL. (Not currently a built-in option — see "Future enhancements" in the [ARCHITECTURE.md](./ARCHITECTURE.md). For now, see option 2.)

### Disable site-wide via a setting

Add this snippet BEFORE the polyfill script tag in your theme's `<head>`:

```html
<script>
  window.Shopify = window.Shopify || {};
  window.Shopify.RetenkaStandardEventsPolyfillDisabled = true;
</script>
```

### Remove entirely

Delete the `<script type="module" src=".../@retenka/storefront-events-polyfill...">` tag from your theme.

## Troubleshooting

### "I added the script but events still don't fire"

1. Open browser DevTools → Network tab, reload the storefront, filter on "polyfill". You should see:
   - A 200 response for `auto.js`
   - A 200 response for `standard-events.js` from `cdn.shopify.com`
     If either is missing, the script isn't loading — check the snippet is in the right file.

2. Check Console for errors:

   ```js
   window.__retenkaStandardEventsPolyfill;
   ```

   If `null`, install failed — the error is logged to console.

3. Confirm your theme uses AJAX cart endpoints (not just full-page form submissions). The polyfill intercepts AJAX calls; full-page POSTs to `/cart/add` (no `.js`) trigger a full page navigation and the polyfill can't help (the new page will have a fresh state anyway).

### "I see double events"

Either your theme has also adopted native standard events (in which case the polyfill should auto-disable on next page visibility change — confirm via `window.__retenkaStandardEventsPolyfill?.isDisabled()`) or another app is also dispatching the events. Uninstall the polyfill (see above) once you confirm the theme has migrated.

### "Will this slow my storefront down?"

Negligibly. The polyfill is ~2.6 KB brotlied and only intercepts cart endpoints (the URL match is one regex test per fetch call). The Shopify-hosted `standard-events.js` module is browser-cached after first load and is the same module Shopify's own actions runtime would lazy-load — your customers download it once.

### "Will Shopify Theme Inspector / Shopify Theme Check flag this?"

No. The polyfill is a JavaScript module loaded via `<script type="module">`, not a Liquid file or a theme asset. Shopify's static theme checks don't analyze external JS modules.

### "Does this break my checkout?"

No. The polyfill only intercepts `/cart/*.js` AJAX calls on the storefront. The checkout runs on a separate domain (`<shop>.myshopify.com/checkouts/...`) with its own JavaScript runtime — the polyfill doesn't run there at all.

## Support

- Issues: https://github.com/webkraftz/storefront-events-polyfill/issues
- Source: https://github.com/webkraftz/storefront-events-polyfill
- License: [MIT](../LICENSE)
