---
"@retenka/storefront-events-polyfill": patch
---

Fix TypeScript overload-typing mismatch in the XHR interceptor. The
`patchedOpen` / `patchedSend` wrappers previously used
`Parameters<typeof X>` which only resolves to the LAST overload of
`XhrProto.open`, requiring a runtime-only cast that ESLint correctly
flagged as suspicious. Rewrote both with explicit signatures matching
the overload union directly. No behavioral change; runtime is identical.
