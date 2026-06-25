---
"@retenka/storefront-events-polyfill": patch
---

Fix silent passthrough on FormData cart bodies. Shopify themes ship FormData
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
