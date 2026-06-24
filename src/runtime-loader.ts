/**
 * Loads Shopify's official `standard-events.js` module from the platform CDN
 * and exposes it on `window.Shopify.StandardEvents`. The module is the
 * authoritative source of `CartLinesUpdateEvent` / `CartNoteUpdateEvent` /
 * `CartDiscountUpdateEvent` / `CartErrorEvent` classes with their
 * `createPromise()` and `createCartFromAjaxResponse()` static helpers.
 *
 * The URL is hardcoded to the public Shopify CDN path the platform itself
 * uses (verified 2026-06-24 against
 * `https://cdn.shopify.com/storefront/standard-events.js` returning 200 +
 * `text/javascript` + `CartLinesUpdateEvent` symbol). The same module is what
 * `Shopify.actions.updateCart` lazy-imports internally via
 * `import('./standard-events.js')`, so browser caching is shared.
 *
 * The load is deduplicated across multiple polyfill installs in the same
 * document (which shouldn't happen but is defensive against bundlers that
 * import this twice).
 */

import { readStandardEventsLibrary } from "./capability.js";
import { type StandardEventsModule } from "./types.js";

export const SHOPIFY_STANDARD_EVENTS_URL = "https://cdn.shopify.com/storefront/standard-events.js";

let inflightLoad: Promise<StandardEventsModule> | null = null;

/**
 * Resolves to the loaded standard-events module. If the library is already
 * loaded (theme loaded it, or a previous call resolved), returns the cached
 * reference immediately. Otherwise dynamically imports the module from the
 * Shopify CDN and exposes it on `window.Shopify.StandardEvents`.
 */
export async function loadStandardEventsModule(
  url: string = SHOPIFY_STANDARD_EVENTS_URL,
): Promise<StandardEventsModule> {
  const cached = readStandardEventsLibrary();
  if (cached) return cached;

  if (inflightLoad) return inflightLoad;

  inflightLoad = (async (): Promise<StandardEventsModule> => {
    try {
      const mod = (await import(/* @vite-ignore */ url)) as StandardEventsModule;
      assertModuleShape(mod);
      exposeOnWindow(mod);
      return mod;
    } catch (err) {
      inflightLoad = null;
      throw new StandardEventsLoadError(
        `Failed to load Shopify standard-events.js from ${url}`,
        err,
      );
    }
  })();

  return inflightLoad;
}

/** Reset internal load state. Tests use this to isolate runs. */
export function resetLoaderState(): void {
  inflightLoad = null;
}

function assertModuleShape(mod: unknown): asserts mod is StandardEventsModule {
  const isObject = typeof mod === "object" && mod !== null;
  const m = mod as Partial<StandardEventsModule>;
  if (
    !isObject ||
    typeof m.CartLinesUpdateEvent !== "function" ||
    typeof m.CartNoteUpdateEvent !== "function" ||
    typeof m.CartDiscountUpdateEvent !== "function" ||
    typeof m.CartErrorEvent !== "function"
  ) {
    throw new StandardEventsLoadError(
      "standard-events module shape mismatch — missing one of: " +
        "CartLinesUpdateEvent, CartNoteUpdateEvent, CartDiscountUpdateEvent, CartErrorEvent",
    );
  }

  const lines = m.CartLinesUpdateEvent;
  if (
    typeof lines.createPromise !== "function" ||
    typeof lines.createCartFromAjaxResponse !== "function" ||
    typeof lines.eventName !== "string"
  ) {
    throw new StandardEventsLoadError(
      "CartLinesUpdateEvent missing required static methods (createPromise / createCartFromAjaxResponse / eventName)",
    );
  }
}

function exposeOnWindow(mod: StandardEventsModule): void {
  if (typeof window === "undefined") return;
  const shopify = (window.Shopify ??= {});
  if (!shopify.StandardEvents) {
    shopify.StandardEvents = mod;
  }
}

/** Thrown when the polyfill cannot load the standard-events module. */
export class StandardEventsLoadError extends Error {
  override readonly name = "StandardEventsLoadError";
  constructor(message: string, cause?: unknown) {
    super(message, cause !== undefined ? { cause } : undefined);
  }
}
